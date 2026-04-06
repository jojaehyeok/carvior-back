import { Controller, Post, UseInterceptors, UploadedFile, UploadedFiles, Body, BadRequestException, Delete, Query, Get, Param, Patch } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { InspectionService } from './inspection.service';

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
  @Get('report/by-hash/:carHash')
  async getReportByHash(@Param('carHash') carHash: string) {
    const inspection = await this.inspectionService.getInspectionByCarHash(carHash);
    return this.formatReport(inspection);
  }

  // 5-b. 레포트 조회 - bookingId 기반 (내부/앱용)
  @Get('report/:bookingId')
  async getReportData(@Param('bookingId') bookingId: string) {
    const inspection = await this.inspectionService.getInspectionByBookingId(parseInt(bookingId));
    return this.formatReport(inspection);
  }

  private formatReport(inspection: any) {
    return {
      completedAt: inspection.completedAt,
      car_info: {
        number: inspection.carNumber,
        type: inspection.carModel,
        mileage: inspection.mileage,
        color: inspection.color,
        repairCost: inspection.repairCost,
      },
      evaluation: {
        ...inspection.inspectionDetails,
        memo: inspection.memo,
      },
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
    };
  }
}