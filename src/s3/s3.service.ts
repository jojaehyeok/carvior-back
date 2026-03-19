import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

@Injectable()
export class S3Service {
    private s3Client: S3Client;

    constructor(private configService: ConfigService) {
        this.s3Client = new S3Client({
            // ✅ 뒤에 'as string'을 붙여서 타입스크립트를 안심시켜주세요.
            region: this.configService.get<string>('AWS_S3_REGION') as string,
            credentials: {
                accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY') as string,
                secretAccessKey: this.configService.get<string>('AWS_SECRET_KEY') as string,
            },
        });
    }

    async uploadFile(file: Express.Multer.File, key: string) {
        const bucket = this.configService.get('AWS_S3_BUCKET_NAME');

        await this.s3Client.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: key, // 예: inspections/1/exterior/image.jpg
                Body: file.buffer,
                ContentType: file.mimetype,
            }),
        );

        return `https://${bucket}.s3.${this.configService.get('AWS_S3_REGION')}.amazonaws.com/${key}`;
    }
}