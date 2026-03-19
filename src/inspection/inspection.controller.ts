import { Controller, Post, UseInterceptors, UploadedFile, Body, BadRequestException, Req } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import express from 'express'; // 추가
import { InspectionService } from './inspection.service';

@Controller('v1/external/inspection')
export class InspectionController {
  constructor(private readonly inspectionService: InspectionService) { }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('requestId') requestId: string,
    @Body('category') category: string,
    @Body('carNumber') carNumber: string, // 👈 앱에서 보낼 차번호 추가
  ) {
    if (!file) {
      throw new BadRequestException('파일이 없습니다.');
    }

    // 서비스 호출 시 carNumber 전달
    const s3Url = await this.inspectionService.uploadToS3(file, requestId, category, carNumber);

    return { url: s3Url };
  }
}