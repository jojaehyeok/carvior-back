import { Controller, Post, UseInterceptors, UploadedFile, UploadedFiles, Body, BadRequestException, Delete, Query, Get, Param, Patch, UseGuards, Res } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { InspectionService } from './inspection.service';
import { InternalKeyGuard } from '../store-items/internal-key.guard';

@Controller('v1/external/inspection')
export class InspectionController {
  constructor(private readonly inspectionService: InspectionService) { }

  // 1. 이미지 업로드 (단일)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('requestId') requestId: string,
    @Body('category') category: string,
    @Body('carNumber') carNumber: string,
  ) {
    if (!file) throw new BadRequestException('파일이 없습니다.');
    const url = await this.inspectionService.uploadToS3(file, requestId, category, carNumber);
    return { url };
  }

  // 1-b. 배치 이미지 업로드 (최대 70장 병렬 처리)
  @Post('upload/batch')
  @UseInterceptors(FilesInterceptor('files', 80)) // 최대 80개
  async uploadBatch(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('requestId') requestId: string,
    @Body('category') category: string,
    @Body('carNumber') carNumber: string,
  ) {
    if (!files || files.length === 0) throw new BadRequestException('파일이 없습니다.');
    console.log(`[Batch Upload] 요청 | requestId=${requestId} | category=${category} | 파일수=${files.length}`);
    const results = await this.inspectionService.uploadBatchToS3(files, requestId, category, carNumber);
    const successUrls = results.filter((r) => r.url !== null).map((r) => r.url);
    const failures = results.filter((r) => r.url === null);
    if (failures.length > 0) {
      console.warn(`[Batch Upload] 일부 실패 | 실패목록=${failures.map((f) => f.originalname).join(', ')}`);
    }
    return { urls: successUrls, total: files.length, success: successUrls.length, failed: failures.length };
  }

  // 2. 최종 제출 (프런트엔드 payload 전체 수용)
  @Post('submit')
  async submitInspection(@Body() inspectionData: any) {
    // 필수값 검증
    if (!inspectionData.requestId) throw new BadRequestException('requestId가 누락되었습니다.');
    
    const result = await this.inspectionService.saveInspectionResult(inspectionData);
    return { success: true, data: result };
  }

  // 3. S3 파일 삭제
  @Delete('upload')
  async deleteFile(@Query('url') url: string) {
    return await this.inspectionService.deleteFromS3(url);
  }

  // 4. 제출 완료 후 개별 사진 추가 (백그라운드 업로드용)
  @Patch(':bookingId/photo')
  async addPhoto(
    @Param('bookingId') bookingId: string,
    @Body('category') category: string,
    @Body('url') url: string,
  ) {
    return await this.inspectionService.appendPhoto(parseInt(bookingId), category, url);
  }

  // 5. 레포트 조회 - 차량번호 해시 기반 (공개 URL용)
  // lang: 딜러 의뢰 리포트(수출용 차량 등)에서만 en/ru/ar 지원 — 구매동행 리포트는 무시됨
  @Get('report/by-hash/:carHash')
  async getReportByHash(@Param('carHash') carHash: string, @Query('lang') lang?: string) {
    const inspection = await this.inspectionService.getInspectionByCarHash(carHash);
    const localized = await this.inspectionService.applyLanguage(inspection, lang);
    return this.formatReport(localized);
  }

  // 5-a. 리포트 사진 전체를 1,2,3...번 순서로 이름 붙여 zip 다운로드 (광고팀용 일괄 다운로드)
  @Get('report/by-hash/:carHash/zip')
  async downloadPhotosZip(@Param('carHash') carHash: string, @Res() res: Response) {
    await this.inspectionService.streamPhotosZip(carHash, res);
  }

  // 5-b. 레포트 조회 - bookingId 기반 (내부/앱용)
  @Get('report/:bookingId')
  async getReportData(@Param('bookingId') bookingId: string, @Query('lang') lang?: string) {
    const inspection = await this.inspectionService.getInspectionByBookingId(parseInt(bookingId));
    const localized = await this.inspectionService.applyLanguage(inspection, lang);
    return this.formatReport(localized);
  }

  // 5-c. 관리자 → 진단사 재촬영/수정 요청 (SMS)
  @Post(':bookingId/request-update')
  @UseGuards(InternalKeyGuard)
  requestUpdate(
    @Param('bookingId') bookingId: string,
    @Body('message') message?: string,
    @Body('category') category?: string,
    @Body('recipientDriverId') recipientDriverId?: number,
  ) {
    return this.inspectionService.requestUpdateFromEvaluator(
      parseInt(bookingId), message, category, recipientDriverId ? Number(recipientDriverId) : undefined,
    );
  }

  // 수정 요청 SMS 과금(회사별 누적) 내역 — source 주면 자사분만, 안 주면(슈퍼관리자) 전체
  @Get('sms-billing-summary')
  @UseGuards(InternalKeyGuard)
  getSmsBillingSummary(@Query('source') source?: string) {
    return this.inspectionService.getSmsBillingSummary(source);
  }

  // 구매동행(카비어 검차) 완료 고객에게 리뷰 요청 SMS 재발송 — 관리자가 대시보드에서 수동 트리거
  @Post(':bookingId/request-review')
  @UseGuards(InternalKeyGuard)
  requestReview(@Param('bookingId') bookingId: string) {
    return this.inspectionService.requestReview(parseInt(bookingId));
  }

  // 6. 관리자(진단매니저) → 손상부위 웹 수정
  @Patch(':bookingId/damages')
  @UseGuards(InternalKeyGuard)
  updateDamages(
    @Param('bookingId') bookingId: string,
    @Body('checkedDamages') checkedDamages: string[][],
  ) {
    return this.inspectionService.updateDamages(parseInt(bookingId), checkedDamages);
  }

  // 7. 관리자/발주사 → 완료된 리포트 오탈자·누락값 직접 수정 (스마트옥션 매물 등록과는 별개)
  @Patch(':bookingId/report-fields')
  @UseGuards(InternalKeyGuard)
  updateReportFields(
    @Param('bookingId') bookingId: string,
    @Body() data: {
      carNumber?: string; carModel?: string; mileage?: number; color?: string; repairCost?: number;
      memo?: string; inspectionDetails?: { warningDesc?: string; leakDesc?: string; optionsDesc?: string; driveDesc?: string; engineDesc?: string };
      photos?: Record<string, string[]>; dashboardImage?: string; regImage?: string; vinImage?: string;
      exportVideoUrls?: string[]; engineNoiseVideoUrl?: string; videoUrls?: string[];
      checklistPhotos?: { warning?: string[]; options?: string[]; leak?: string[]; drive?: string[]; engine?: string[] };
    },
  ) {
    return this.inspectionService.updateReportFields(parseInt(bookingId), data);
  }

  private formatReport(inspection: any) {
    return {
      completedAt: inspection.completedAt,
      firstCompletedAt: inspection.firstCompletedAt,
      bookingId: inspection.bookingId,
      dealerName: inspection.dealerName ?? null,
      driverName: inspection.driverName ?? null,
      assignedDriverId: inspection.assignedDriverId ?? null,
      driverPhotoUrl: inspection.driverPhotoUrl ?? null,
      driverCompletedCount: inspection.driverCompletedCount ?? 0,
      isConsumerBooking: !!inspection.isConsumerBooking,
      car_info: {
        number: inspection.carNumber,
        type: inspection.carModel,
        owner: inspection.carOwner ?? null,
        mileage: inspection.mileage,
        color: inspection.color,
        repairCost: inspection.repairCost,
      },
      evaluation: {
        ...inspection.inspectionDetails,
        memo: inspection.memo,
      },
      evaluationOk: inspection.evaluationOk ?? null,
      checklistPhotos: inspection.checklistPhotos ?? { warning: [], options: [], leak: [], drive: [] },
      car_status: {
        keys: inspection.carStatus?.keys,
        paintNeeded: inspection.carStatus?.paintNeeded,
        wheelScratch: inspection.carStatus?.wheelScratch,
        tireTread: inspection.carStatus?.tireTread,
      },
      damages: inspection.checkedDamages,
      mirror_markers: inspection.mirrorMarkers,
      images: {
        ...inspection.photos,
        dashboard: inspection.dashboardImage ? [inspection.dashboardImage] : [],
        registration: inspection.regImage ? [inspection.regImage] : [],
        vin: inspection.vinImage ? [inspection.vinImage] : [],
      },
      exportVideoUrls: inspection.exportVideoUrls ?? [],
      engineNoiseVideoUrl: inspection.engineNoiseVideoUrl ?? null,
      videoUrls: inspection.videoUrls ?? [],
    };
  }
}