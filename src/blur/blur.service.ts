import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

interface Box { xmin: number; ymin: number; xmax: number; ymax: number }

@Injectable()
export class BlurService implements OnModuleInit {
  private readonly logger = new Logger(BlurService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor(config: ConfigService) {
    this.s3 = new S3Client({
      region: config.get('AWS_S3_REGION') || 'ap-northeast-2',
      credentials: {
        accessKeyId: config.get('AWS_ACCESS_KEY') as string,
        secretAccessKey: config.get('AWS_SECRET_KEY') as string,
      },
    });
    this.bucket = config.get('AWS_S3_BUCKET_NAME') as string;
    this.region = config.get('AWS_S3_REGION') || 'ap-northeast-2';
  }

  async onModuleInit() {
    this.logger.log('[Blur] 서비스 준비 완료 (로컬 classify-api 사용)');
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

  // 방향이 정규화된(=올바르게 회전된) buffer를 그대로 전송 — URL로 다시 받으면
  // Python 쪽이 원본을 재요청해서 방향 보정 전 픽셀 기준으로 박스를 계산해버림
  private async detectPlatesLocal(imageBuffer: Buffer): Promise<Box[]> {
    try {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }), 'photo.jpg');
      const res = await fetch('http://127.0.0.1:8001/detect-plates', {
        method: 'POST',
        body: form,
      });
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json.boxes) ? (json.boxes as Box[]) : [];
    } catch {
      return [];
    }
  }

  private async detectFaces(_imageBuffer: Buffer): Promise<Box[]> {
    return [];
  }

  private async detectPlates(imageBuffer: Buffer): Promise<Box[]> {
    return this.detectPlatesLocal(imageBuffer).catch(() => []);
  }

  private async blurRegions(imageBuffer: Buffer, boxes: Box[]): Promise<Buffer> {
    if (boxes.length === 0) return imageBuffer;

    const meta = await sharp(imageBuffer).metadata();
    const imgW = meta.width ?? 1;
    const imgH = meta.height ?? 1;

    const logoPath = path.join(__dirname, 'logo.png');
    const logoBuffer = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

    const overlays = (
      await Promise.all(
        boxes.map(async (box): Promise<sharp.OverlayOptions | null> => {
          const left   = Math.max(0, Math.floor(box.xmin));
          const top    = Math.max(0, Math.floor(box.ymin));
          const width  = Math.min(imgW - left, Math.ceil(box.xmax - box.xmin));
          const height = Math.min(imgH - top,  Math.ceil(box.ymax - box.ymin));
          if (width < 2 || height < 2) return null;

          if (logoBuffer) {
            const overlay = await sharp(logoBuffer)
              .resize(width, height, { fit: 'fill' })
              .flatten({ background: { r: 255, g: 255, b: 255 } })
              .toBuffer();
            return { input: overlay, left, top };
          }

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
    // 재처리(같은 사진을 다시 blur)로 들어온 ?v= 캐시버스팅 쿼리는 키 계산에서 제외
    const withoutQuery = originalUrl.split('?')[0];
    const after = withoutQuery.split('.amazonaws.com/')[1];
    if (!after) throw new Error('S3 URL 파싱 실패: ' + originalUrl);
    // store/ 중복 방지
    const cleanAfter = after.startsWith('store/') ? after.slice('store/'.length) : after;
    const key = `store/${cleanAfter}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: 'image/jpeg',
      }),
    );
    // 같은 키를 덮어쓰면 브라우저/CDN이 이전(방향 틀어진) 캐시를 계속 보여줄 수 있어
    // 버전 쿼리로 캐시를 무효화
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}?v=${Date.now()}`;
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
          // store/ URL이면 원본 경로로 복원해서 재처리
          const effectiveUrl = url.includes('.amazonaws.com/store/')
            ? url.replace('.amazonaws.com/store/', '.amazonaws.com/')
            : url;

          try {
            const rawBuf = await this.fetchBuffer(effectiveUrl);
            // EXIF 방향을 실제 픽셀에 반영 + 태그 제거 → 이후 전 단계가 이 buf 기준으로 통일됨
            // (안 하면 세로로 든 폰/가로로 든 폰 사진이 서로 다른 방향으로 저장되던 문제)
            const buf = await sharp(rawBuf).rotate().toBuffer();
            const [faces, plates] = await Promise.all([
              this.detectFaces(buf),
              this.detectPlates(buf),
            ]);
            const boxes = [...faces, ...plates];
            this.logger.log(
              `[Blur] 얼굴:${faces.length} 번호판:${plates.length} ← ${effectiveUrl.split('/').pop()}`,
            );
            const blurred = await this.blurRegions(buf, boxes);
            const newUrl = await this.reuploadToS3(blurred, effectiveUrl);
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
