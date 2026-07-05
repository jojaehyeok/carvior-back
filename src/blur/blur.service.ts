import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as sharp from 'sharp';
import * as https from 'https';
import * as http from 'http';

interface Box { xmin: number; ymin: number; xmax: number; ymax: number }

@Injectable()
export class BlurService implements OnModuleInit {
  private readonly logger = new Logger(BlurService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly region: string;
  private readonly hfToken: string;

  constructor(private readonly config: ConfigService) {
    this.s3 = new S3Client({
      region: config.get('AWS_S3_REGION') || 'ap-northeast-2',
      credentials: {
        accessKeyId: config.get('AWS_ACCESS_KEY') as string,
        secretAccessKey: config.get('AWS_SECRET_KEY') as string,
      },
    });
    this.bucket = config.get('AWS_S3_BUCKET_NAME') as string;
    this.region = config.get('AWS_S3_REGION') || 'ap-northeast-2';
    this.hfToken = config.get('HF_TOKEN') || '';
  }

  async onModuleInit() {
    this.logger.log('[Blur] 서비스 준비 완료 (Hugging Face API 사용)');
  }

  private fetchBuffer(url: string, redirectCount = 0): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (redirectCount > 5) return reject(new Error('리다이렉트 초과'));
      const proto = url.startsWith('https') ? https : http;
      proto.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return this.fetchBuffer(res.headers.location!, redirectCount + 1)
            .then(resolve).catch(reject);
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  private async hfObjectDetect(imageBuffer: Buffer, model: string): Promise<Box[]> {
    return new Promise((resolve) => {
      const body = imageBuffer;
      const hostname = 'api-inference.huggingface.co';
      const path = `/models/${model}`;

      const options = {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': body.length,
          ...(this.hfToken ? { Authorization: `Bearer ${this.hfToken}` } : {}),
        },
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString());
            if (!Array.isArray(json)) {
              // 모델 로딩 중(503) 이거나 오류
              resolve([]);
              return;
            }
            resolve(
              json
                .filter((r: any) => r.score > 0.45 && r.box)
                .map((r: any) => r.box as Box)
            );
          } catch {
            resolve([]);
          }
        });
      });
      req.on('error', () => resolve([]));
      req.write(body);
      req.end();
    });
  }

  private async detectFaces(imageBuffer: Buffer): Promise<Box[]> {
    try {
      return await this.hfObjectDetect(imageBuffer, 'Xenova/yolov8n-face');
    } catch (e) {
      this.logger.warn('[Blur] 얼굴 감지 실패: ' + e.message);
      return [];
    }
  }

  private async detectPlates(imageBuffer: Buffer): Promise<Box[]> {
    try {
      return await this.hfObjectDetect(
        imageBuffer,
        'nickmuchi/yolos-small-rego-plates-detection',
      );
    } catch (e) {
      this.logger.warn('[Blur] 번호판 감지 실패: ' + e.message);
      return [];
    }
  }

  private async blurRegions(imageBuffer: Buffer, boxes: Box[]): Promise<Buffer> {
    if (boxes.length === 0) return imageBuffer;

    const meta = await sharp(imageBuffer).metadata();
    const imgW = meta.width ?? 1;
    const imgH = meta.height ?? 1;

    const overlays = (
      await Promise.all(
        boxes.map(async (box): Promise<sharp.OverlayOptions | null> => {
          const left   = Math.max(0, Math.floor(box.xmin));
          const top    = Math.max(0, Math.floor(box.ymin));
          const width  = Math.min(imgW - left, Math.ceil(box.xmax - box.xmin));
          const height = Math.min(imgH - top,  Math.ceil(box.ymax - box.ymin));
          if (width < 2 || height < 2) return null;

          const blurred = await sharp(imageBuffer)
            .extract({ left, top, width, height })
            .blur(28)
            .toBuffer();
          return { input: blurred, left, top };
        })
      )
    ).filter((x): x is sharp.OverlayOptions => x !== null);

    if (overlays.length === 0) return imageBuffer;

    return sharp(imageBuffer)
      .composite(overlays)
      .jpeg({ quality: 88 })
      .toBuffer();
  }

  private async reuploadToS3(buffer: Buffer, originalUrl: string): Promise<string> {
    const after = originalUrl.split('.amazonaws.com/')[1];
    if (!after) throw new Error('S3 URL 파싱 실패: ' + originalUrl);
    const key = `store/${after}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: 'image/jpeg',
      }),
    );
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async blurPhotoUrls(urls: string[]): Promise<string[]> {
    if (!urls.length) return [];

    const CONCURRENCY = 3;
    const out: string[] = new Array(urls.length);

    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const slice = urls.slice(i, i + CONCURRENCY);

      const results = await Promise.all(
        slice.map(async (url, j): Promise<[number, string]> => {
          const idx = i + j;
          // store/ 경로로 이미 처리된 이미지는 재처리 생략
          if (url.includes('/store/')) return [idx, url];

          try {
            const buf = await this.fetchBuffer(url);
            const [faces, plates] = await Promise.all([
              this.detectFaces(buf),
              this.detectPlates(buf),
            ]);
            const boxes = [...faces, ...plates];
            this.logger.log(
              `[Blur] 얼굴:${faces.length} 번호판:${plates.length} ← ${url.split('/').pop()}`,
            );
            const blurred = await this.blurRegions(buf, boxes);
            const newUrl = await this.reuploadToS3(blurred, url);
            return [idx, newUrl];
          } catch (e) {
            this.logger.error(`[Blur] 실패(원본유지): ${(e as Error).message}`);
            return [idx, url];
          }
        }),
      );

      for (const [idx, url] of results) out[idx] = url;
    }

    return out;
  }
}
