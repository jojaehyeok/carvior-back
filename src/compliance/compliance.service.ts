import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComplianceRecord } from './entities/compliance-record.entity';
import { OcrService } from '../ocr/ocr.service';

const RETENTION_YEARS = 3;

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    @InjectRepository(ComplianceRecord)
    private readonly repo: Repository<ComplianceRecord>,
    private readonly ocrService: OcrService,
  ) {}

  // 등록증 이미지 URL로 OCR을 실행해서 법정 보관 항목 스냅샷을 저장.
  // 실패해도 예외를 던지지 않음 — 호출부(진단 저장/매물 등록)는 이 기록 저장 여부와
  // 무관하게 정상 처리되어야 하므로 항상 fire-and-forget으로 호출할 것.
  async captureFromRegistrationImage(params: {
    imageUrl: string;
    storeItemId?: number;
    bookingId?: number;
    carHash?: string;
    plateNumberFallback?: string;
  }) {
    try {
      const ocr = await this.ocrService.parseFromUrl(params.imageUrl, 'registration');
      if ((ocr as any)?.error) {
        this.logger.warn(`[컴플라이언스] 등록증 OCR 실패: ${(ocr as any).error} (image=${params.imageUrl})`);
        return null;
      }

      const now = new Date();
      const retainUntil = new Date(now);
      retainUntil.setFullYear(retainUntil.getFullYear() + RETENTION_YEARS);

      const record = this.repo.create({
        storeItemId: params.storeItemId,
        bookingId: params.bookingId,
        carHash: params.carHash,
        plateNumber: (ocr as any).plateNumber || params.plateNumberFallback || '미상',
        vin: (ocr as any).vin,
        carName: (ocr as any).carName,
        vehicleType: (ocr as any).vehicleType,
        engineType: (ocr as any).engineType,
        usageType: (ocr as any).usageType,
        modelYear: (ocr as any).modelYear,
        color: (ocr as any).color,
        mileage: (ocr as any).mileage,
        registrationDate: (ocr as any).registrationDate,
        manufactureDate: (ocr as any).manufactureDate,
        inspectionValidUntil: (ocr as any).inspectionValidUntil,
        ownerName: (ocr as any).ownerName,
        ownerAddress: (ocr as any).ownerAddress,
        sourceImageUrl: params.imageUrl,
        rawOcr: ocr as Record<string, unknown>,
        retainUntil,
      });
      return await this.repo.save(record);
    } catch (e) {
      this.logger.error(`[컴플라이언스] 기록 저장 실패: ${(e as Error).message}`);
      return null;
    }
  }

  // 이미 파싱된 OCR 결과(프론트에서 등록 시점에 미리 스캔해둔 raw 데이터)를 그대로 저장 —
  // 다시 OCR을 호출하지 않아도 되는 경우(셀프등록 등)에 사용
  async captureFromParsedOcr(params: {
    ocr: Record<string, unknown>;
    imageUrl?: string;
    storeItemId?: number;
    bookingId?: number;
    carHash?: string;
    plateNumberFallback?: string;
  }) {
    try {
      const ocr = params.ocr ?? {};
      const now = new Date();
      const retainUntil = new Date(now);
      retainUntil.setFullYear(retainUntil.getFullYear() + RETENTION_YEARS);

      const record = this.repo.create({
        storeItemId: params.storeItemId,
        bookingId: params.bookingId,
        carHash: params.carHash,
        plateNumber: (ocr.plateNumber as string) || params.plateNumberFallback || '미상',
        vin: ocr.vin as string,
        carName: ocr.carName as string,
        vehicleType: ocr.vehicleType as string,
        engineType: ocr.engineType as string,
        usageType: ocr.usageType as string,
        modelYear: ocr.modelYear as string,
        color: ocr.color as string,
        mileage: ocr.mileage as string,
        registrationDate: ocr.registrationDate as string,
        manufactureDate: ocr.manufactureDate as string,
        inspectionValidUntil: ocr.inspectionValidUntil as string,
        ownerName: ocr.ownerName as string,
        ownerAddress: ocr.ownerAddress as string,
        sourceImageUrl: params.imageUrl,
        rawOcr: ocr,
        retainUntil,
      });
      return await this.repo.save(record);
    } catch (e) {
      this.logger.error(`[컴플라이언스] 기록 저장 실패: ${(e as Error).message}`);
      return null;
    }
  }

  findAll() {
    return this.repo.find({ order: { capturedAt: 'DESC' } });
  }

  findByPlate(plateNumber: string) {
    return this.repo.find({ where: { plateNumber }, order: { capturedAt: 'DESC' } });
  }
}
