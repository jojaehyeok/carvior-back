import { Controller, Post, UseInterceptors, UploadedFile, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InspectionService } from './inspection.service';

@Controller('api/v1/external/inspection')
export class InspectionController {
  constructor(private readonly inspectionService: InspectionService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file')) // 앱의 formData.append('file', ...) 과 일치
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('requestId') requestId: string,
    @Body('category') category: string,
  ) {
    // S3 업로드 서비스 호출
    const s3Url = await this.inspectionService.uploadToS3(file, requestId, category);
    
    // DB 저장 로직이 필요하다면 여기서 수행 (예: InspectionImage 테이블에 insert)
    
    return { url: s3Url };
  }
}