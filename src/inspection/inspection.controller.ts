import { Controller, Post, UseInterceptors, UploadedFile, Body, BadRequestException, Delete, Query, Get, Param } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InspectionService } from './inspection.service';

@Controller('v1/external/inspection')
export class InspectionController {
  constructor(private readonly inspectionService: InspectionService) { }

  // 1. 이미지 업로드 (이미 있는 코드)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('requestId') requestId: string,
    @Body('category') category: string,
    @Body('carNumber') carNumber: string,
  ) {
    if (!file) throw new BadRequestException('파일이 없습니다.');
    const s3Url = await this.inspectionService.uploadToS3(file, requestId, category, carNumber);
    return { url: s3Url };
  }

  // 2. 최종 데이터 저장 (새로 추가할 코드!)
  @Post('submit') // 👈 앱에서 호출하는 /submit 경로 생성
  async submitInspection(@Body() inspectionData: any) {
    console.log('--- 앱에서 들어온 최종 데이터 ---');
    console.log(inspectionData);

    // 여기서 실제 DB 저장 로직이 들어갑니다.
    // 보통 서비스(InspectionService)로 데이터를 넘겨서 DB에 박습니다.
    const result = await this.inspectionService.saveInspectionResult(inspectionData);

    return { success: true, data: result };
  }

  // 3. 이미지 삭제 (이미 있는 코드)
  @Delete('upload')
  async deleteFile(@Query('url') url: string) {
    return await this.inspectionService.deleteFromS3(url);
  }

  @Get(':bookingId')
  async getInspection(@Param('bookingId') bookingId: string) {
    return await this.inspectionService.getInspectionByBookingId(parseInt(bookingId));
  }
}