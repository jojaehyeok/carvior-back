import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config'; // ✅ ConfigService 추가
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

@Injectable()
export class InspectionService {
  private s3Client: S3Client;

  constructor(private configService: ConfigService) {
    // ✅ 생성자에서 안전하게 초기화
    this.s3Client = new S3Client({
      region: this.configService.get('AWS_S3_REGION') as string,
      credentials: {
        accessKeyId: this.configService.get('AWS_ACCESS_KEY') as string,
        secretAccessKey: this.configService.get('AWS_SECRET_KEY') as string,
      },
    });
  }

  async uploadToS3(file: Express.Multer.File, requestId: string, category: string): Promise<string> {
    const bucket = this.configService.get('AWS_S3_BUCKET_NAME') as string; // ✅ 버킷명도 env에서!
    
    // 파일명 한글 깨짐 방지를 위해 인코딩 처리하거나 타임스탬프를 적극 활용하세요.
    const key = `inspections/${requestId}/${category}/${Date.now()}_${file.originalname}`;

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    // ✅ 리전 정보도 변수화하면 나중에 이사갈 때 편합니다.
    const region = this.configService.get('AWS_S3_REGION');
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }
}