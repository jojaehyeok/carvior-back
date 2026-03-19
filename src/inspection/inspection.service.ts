import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from 'src/bookings/entities/booking.entity'; // 경로 확인 필요
import { Inspection } from './entities/inspection.entity'; // 경로 확인 필요

@Injectable()
export class InspectionService {
  private s3Client: S3Client;

  constructor(
    private configService: ConfigService,
    @InjectRepository(Inspection)
    private readonly inspectionRepository: Repository<Inspection>,
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
  ) {
    this.s3Client = new S3Client({
      region: this.configService.get('AWS_S3_REGION') || 'ap-northeast-2',
      credentials: {
        accessKeyId: this.configService.get('AWS_ACCESS_KEY') as string,
        secretAccessKey: this.configService.get('AWS_SECRET_KEY') as string,
      },
    });
  }

  /**
   * 1. S3 이미지 업로드
   * 경로 구조: bucket/차번호/카테고리/타임스탬프_파일명
   */
  async uploadToS3(
    file: Express.Multer.File,
    requestId: string,
    category: string,
    carNumber: string,
  ): Promise<string> {
    const bucket = this.configService.get('AWS_S3_BUCKET_NAME') as string;
    const safeCarNumber = carNumber || requestId; 
    const timestamp = Date.now();
    
    // 파일명 특수문자나 한글 깨짐 방지를 위해 안전하게 처리
    const safeFileName = file.originalname.replace(/\s/g, '_');
    const key = `${safeCarNumber}/${category}/${timestamp}_${safeFileName}`;

    try {
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
    } catch (error) {
      console.error('S3 Upload Error:', error);
      throw new BadRequestException('S3 파일 업로드에 실패했습니다.');
    }
  }

  /**
   * 2. 최종 진단 결과 DB 저장 (Upsert)
   * 앱의 onFinish에서 호출됨
   */
  async saveInspectionResult(data: any) {
    const bId = parseInt(data.requestId);
    if (isNaN(bId)) {
      throw new BadRequestException('유효하지 않은 requestId입니다.');
    }

    // 기존 진단 데이터가 있는지 확인
    let inspection = await this.inspectionRepository.findOne({ where: { bookingId: bId } });

    if (!inspection) {
      // 신규 생성 시
      inspection = new Inspection();
      inspection.bookingId = bId;
    }

    // 데이터 매핑
    inspection.carNumber = data.carNumber;
    inspection.carModel = data.carModel || '알수없음';
    inspection.mileage = data.mileage;
    inspection.dashboardImage = data.dashboardImage;
    inspection.regImage = data.regImage;
    
    // JSON 필드 저장 (엔티티에 정의된 필드명과 일치해야 함)
    inspection.inspectionDetails = data.inspectionDetails;
    inspection.photos = data.photos;

    try {
      // 3. DB 저장 (save는 id가 있으면 update, 없으면 insert)
      const savedResult = await this.inspectionRepository.save(inspection);

      // 4. 예약 상태 업데이트 (진단 완료 처리)
      await this.bookingRepository.update(bId, { status: 'COMPLETED' });

      console.log(`[Success] Inspection saved for Booking ID: ${bId}`);
      return { success: true, id: savedResult.id };
    } catch (error) {
      console.error('DB Save Error:', error);
      throw new BadRequestException('진단 데이터 저장 중 오류가 발생했습니다.');
    }
  }

  /**
   * 3. S3 이미지 삭제
   * 이미지 수정/삭제 시 호출
   */
  async deleteFromS3(url: string) {
    if (!url || !url.includes('.com/')) return { success: false };

    const bucket = this.configService.get('AWS_S3_BUCKET_NAME');
    const key = url.split('.com/')[1];

    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: decodeURIComponent(key),
        }),
      );
      return { success: true };
    } catch (error) {
      console.error('S3 Delete Error:', error);
      return { success: false, message: error.message };
    }
  }

  async getInspectionByBookingId(bookingId: number) {
  const inspection = await this.inspectionRepository.findOne({
    where: { bookingId },
  });
  
  if (!inspection) {
    throw new BadRequestException('해당 예약의 진단 내역을 찾을 수 없습니다.');
  }
  
  return inspection;
}
}