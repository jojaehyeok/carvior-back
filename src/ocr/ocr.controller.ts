import { Controller, Post, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OcrService } from './ocr.service';

@Controller('v1/external/ocr')
export class OcrController {
  constructor(private readonly ocrService: OcrService) {}

  @Post('registration')
  @UseInterceptors(FileInterceptor('file'))
  async ocrRegistration(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('파일이 없습니다.');
    return this.ocrService.parseRegistration(file);
  }
}
