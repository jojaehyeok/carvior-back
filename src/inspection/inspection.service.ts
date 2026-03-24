import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Inspection } from './entities/inspection.entity';
// S3 연동 서비스나 Booking 엔티티가 있다면 임포트 필요

@Injectable()
export class InspectionService {
  constructor(
    @InjectRepository(Inspection)
    private readonly inspectionRepository: Repository<Inspection>,
    private readonly dataSource: DataSource,
  ) { }

  // S3 업로드 로직 (기존 구현 유지 혹은 간단 구현)
  async uploadToS3(file: Express.Multer.File, requestId: string, category: string, carNumber: string): Promise<string> {
    // 실제 S3 업로드 로직을 여기에 구현 (생략)
    return `https://s3-bucket-url/${category}/${Date.now()}_${file.originalname}`;
  }

  // 최종 저장 로직
  async saveInspectionResult(data: any) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. 기존 데이터가 있는지 확인 (업데이트 혹은 생성)
      let inspection = await this.inspectionRepository.findOne({
        where: { bookingId: Number(data.requestId) }
      });

      if (!inspection) {
        inspection = this.inspectionRepository.create({ bookingId: Number(data.requestId) });
      }

      // 2. 프런트엔드 Payload 매핑
      inspection.carNumber = data.carNumber;
      inspection.carModel = data.carModel;
      inspection.mileage = data.mileage;
      inspection.repairCost = data.repairCost; // 검수 전용 비용
      
      // 이미지
      inspection.dashboardImage = data.dashboardImage;
      inspection.regImage = data.regImage;
      inspection.vinImage = data.vinImage;
      inspection.photos = data.photos; // { exterior, wheel, undercarriage, interior, engine }

      // 상세 설명 (프런트엔드 필드명: warningDesc, leakDesc, optionsDesc, driveDesc)
      inspection.inspectionDetails = {
        ...inspection.inspectionDetails, // 기존 값 유지하면서 덮어쓰기
        ...data.inspectionDetails
      };

      // 차량 상태 수치 (키 개수, 타이어 잔량 등)
      (inspection as any).carStatus = {
        keys: data.keys,
        paintNeeded: data.paintNeeded,
        wheelScratch: data.wheelScratch,
        tireTread: { front: data.frontTire, back: data.backTire }
      };

      // 손상 위치 및 사이드미러
      inspection.checkedDamages = data.checkedDamages;
      (inspection as any).mirrorMarkers = data.mirrorMarkers;
      inspection.memo = data.memo;
      inspection.completedAt = new Date();

      const saved = await queryRunner.manager.save(inspection);

      // 3. (옵션) Booking 상태를 COMPLETED로 변경하는 로직 추가 가능
      // await queryRunner.manager.update(Booking, data.requestId, { status: 'COMPLETED' });

      await queryRunner.commitTransaction();
      return saved;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw new InternalServerErrorException('저장 중 오류 발생: ' + err.message);
    } finally {
      await queryRunner.release();
    }
  }

  async getInspectionByBookingId(bookingId: number) {
    return await this.inspectionRepository.findOne({ where: { bookingId } });
  }

  async deleteFromS3(url: string) {
    // S3 삭제 로직 구현
    return { success: true };
  }
}