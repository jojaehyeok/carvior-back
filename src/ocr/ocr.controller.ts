import { Body, Controller, Post, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
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

  @Post('registration/from-url')
  async ocrRegistrationFromUrl(@Body('imageUrl') imageUrl: string) {
    if (!imageUrl) throw new BadRequestException('imageUrl이 없습니다.');
    return this.ocrService.parseFromUrl(imageUrl, 'registration');
  }

  @Post('insurance/from-url')
  async ocrInsuranceFromUrl(@Body('imageUrl') imageUrl: string) {
    if (!imageUrl) throw new BadRequestException('imageUrl이 없습니다.');
    return this.ocrService.parseFromUrl(imageUrl, 'insurance');
  }
}
