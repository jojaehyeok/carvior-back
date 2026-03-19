import { Controller, Post, UseInterceptors, UploadedFile, Body, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InspectionService } from './inspection.service';

@Controller('v1/external/inspection')
export class InspectionController {
  constructor(private readonly inspectionService: InspectionService) { }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file')) // 👈 여기가 'file'이어야 합니다!
  async uploadFile(
    @UploadedFile() file: Express.Multer.File, // 👈 여기서 'file'을 받는데 위와 이름이 같아야 함
    @Body('requestId') requestId: string,
    @Body('category') category: string,
  ) {
    if (!file) { // 👈 안전하게 체크 로직 추가
      console.log('파일이 안 들어왔습니다!');
      throw new BadRequestException('파일이 없습니다.');
    }
    const s3Url = await this.inspectionService.uploadToS3(file, requestId, category);
    return { url: s3Url };
  }
}