import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

@Injectable()
export class InspectionService {
  private s3Client: S3Client;

  constructor(private configService: ConfigService) {
    this.s3Client = new S3Client({
      // ✅ 환경변수 이름이 AWS_S3_REGION인지 AWS_REGION인지 꼭 확인하세요!
      region: this.configService.get('AWS_S3_REGION') || 'ap-northeast-2',
      credentials: {
        accessKeyId: this.configService.get('AWS_ACCESS_KEY') as string,
        secretAccessKey: this.configService.get('AWS_SECRET_KEY') as string,
      },
    });
  }

  async uploadToS3(
    file: Express.Multer.File,
    requestId: string,
    category: string,
    carNumber: string // 👈 차번호 추가
  ): Promise<string> {
    const bucket = this.configService.get('AWS_S3_BUCKET_NAME') as string;

    // ✅ 형님이 원하시는 경로 구조: 차번호/카테고리/타임스탬프_파일명
    // 한글 차번호나 파일명 깨짐 방지를 위해 Key 구성을 정리합니다.
    const safeCarNumber = carNumber || requestId; // 차번호 없으면 요청ID라도 사용
    const timestamp = Date.now();
    const key = `${safeCarNumber}/${category}/${timestamp}_${file.originalname}`;

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    const region = this.configService.get('AWS_S3_REGION') || 'ap-northeast-2';
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  async deleteFromS3(url: string) {
    const bucket = this.configService.get('AWS_S3_BUCKET_NAME');

    // URL에서 S3 Key값만 추출 (예: 차번호/카테고리/파일명.jpg)
    const key = url.split('.com/')[1];

    if (!key) return;

    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: decodeURIComponent(key), // 한글 깨짐 방지
      }),
    );
    return { success: true };
  }
}