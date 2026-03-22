import { Controller, Post, UseInterceptors, UploadedFile, Body, BadRequestException, Delete, Query, Get, Param } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InspectionService } from './inspection.service';

@Controller('v1/external/inspection') // 👈 현재 기본 경로
export class InspectionController {
  constructor(private readonly inspectionService: InspectionService) { }

  // 1. 이미지 업로드/삭제/제출 로직 (기존 코드 유지)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('requestId') requestId: string,
    @Body('category') category: string,
    @Body('carNumber') carNumber: string,
  ) {
    if (!file) throw new BadRequestException('파일이 없습니다.');
    return { url: await this.inspectionService.uploadToS3(file, requestId, category, carNumber) };
  }

  @Post('submit')
  async submitInspection(@Body() inspectionData: any) {
    const result = await this.inspectionService.saveInspectionResult(inspectionData);
    return { success: true, data: result };
  }

  @Delete('upload')
  async deleteFile(@Query('url') url: string) {
    return await this.inspectionService.deleteFromS3(url);
  }

 @Get('report/:bookingId') // 👈 여기에 'report/' 가 정확히 붙어 있는지 확인!
  async getReportData(@Param('bookingId') bookingId: string) {
    console.log('요청 들어옴! ID:', bookingId); // 로그를 찍어서 터미널에 찍히는지 보세요
    const inspection = await this.inspectionService.getInspectionByBookingId(parseInt(bookingId));
    
    if (!inspection) {
      throw new BadRequestException('진단 내역을 찾을 수 없습니다.');
    }

    // 형님의 Entity 구조를 프론트엔드가 기대하는 구조로 변환
    return {
      car_info: {
        number: inspection.carNumber,
        type: inspection.carModel,
        mileage: inspection.mileage,
      },
      // ✅ 엔티티의 inspectionDetails를 evaluation으로 매핑
      evaluation: {
        accidentDesc: inspection.inspectionDetails?.accidentDesc,
        leakDesc: inspection.inspectionDetails?.leakDesc,
        tireDesc: inspection.inspectionDetails?.tireDesc,
        tuningDesc: inspection.inspectionDetails?.tuningDesc,
        warningDesc: inspection.inspectionDetails?.warningDesc,
        notice: inspection.inspectionDetails?.notice,
        merit: inspection.inspectionDetails?.merit,
      },
      // ✅ 엔티티의 photos를 images로 매핑 (필요시 추가 이미지 포함)
      images: {
        ...inspection.photos, // exterior, wheel, undercarriage 등
        dashboard: inspection.dashboardImage ? [inspection.dashboardImage] : [],
        registration: inspection.regImage ? [inspection.regImage] : [],
      }
    };
  }
}