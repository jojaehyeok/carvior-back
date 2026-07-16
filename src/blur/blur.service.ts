import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

interface Box { xmin: number; ymin: number; xmax: number; ymax: number; kind: 'plate' | 'face' }

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
  // Python 쪽이 원본을 재요청해서 방향 보정 전 픽셀 기준으로 박스를 계산해버림.
  // 서버 Node 버전에 따라 전역 fetch/FormData/Blob이 없을 수 있어 http 모듈로 직접 multipart 조립.
  private detectBoxesLocal(imageBuffer: Buffer, endpoint: string, label: string): Promise<Omit<Box, 'kind'>[]> {
    return new Promise((resolve) => {
      const boundary = `----carviorBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;
      const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([head, imageBuffer, tail]);

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: 8001,
          path: endpoint,
          method: 'POST',
          timeout: 25_000,
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            try {
              const json = JSON.parse(Buffer.concat(chunks).toString());
              if (json.error) this.logger.warn(`[Blur] ${label} 감지 오류: ${json.error}`);
              resolve(Array.isArray(json.boxes) ? json.boxes : []);
            } catch (e) {
              this.logger.error(`[Blur] ${label} 감지 응답 파싱 실패: ${(e as Error).message}`);
              resolve([]);
            }
          });
        },
      );
      req.on('error', (e) => {
        this.logger.error(`[Blur] ${label} 감지 요청 실패: ${e.message}`);
        resolve([]);
      });
      req.on('timeout', () => {
        this.logger.error(`[Blur] ${label} 감지 요청 타임아웃 (classify-api 과부하 의심)`);
        req.destroy();
        resolve([]);
      });
      req.write(body);
      req.end();
    });
  }

  // 얼굴은 별도 학습 없이 공개 YOLOv8n(사람 클래스)로 감지 → 머리 부근만 좁혀서 blur 전용으로 처리
  private async detectFaces(imageBuffer: Buffer): Promise<Box[]> {
    const boxes = await this.detectBoxesLocal(imageBuffer, '/detect-faces', '얼굴');
    return boxes.map((b) => ({ ...b, kind: 'face' as const }));
  }

  private async detectPlates(imageBuffer: Buffer): Promise<Box[]> {
    const boxes = await this.detectBoxesLocal(imageBuffer, '/detect-plates', '번호판');
    return boxes.map((b) => ({ ...b, kind: 'plate' as const }));
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

          // 사람(얼굴)은 로고 대신 항상 블러만 — 로고를 넣으면 진단사진을 너무 많이 가림
          if (box.kind === 'plate' && logoBuffer) {
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

    // 번호판 감지가 CPU 기반 YOLO 추론이라 동시 요청이 많으면 classify-api가
    // 못 버티고 죽거나 커넥션을 거부할 수 있어 동시성을 낮추고 배치 사이 텀을 둠
    const CONCURRENCY = 2;
    const out: string[] = new Array(urls.length);

    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      if (i > 0) await new Promise((r) => setTimeout(r, 300));
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
