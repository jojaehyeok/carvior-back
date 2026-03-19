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
    @UploadedFile() file: any, // 타입을 일단 any로 풀어서 확인
    @Req() req: express.Request,       // 원시 요청 객체 주입
    @Body() body: any,
  ) {
    // 💡 여기서 모든 걸 다 까봅시다.
    console.log('--- [DEBUG START] ---');
    console.log('1. Headers:', req.headers['content-type']); // 'multipart/form-data; boundary=...' 인지 확인
    console.log('2. File:', file); 
    console.log('3. Body:', body); 
    console.log('--- [DEBUG END] ---');

    if (!file) {
      // 만약 file은 없는데 body에 데이터가 있다면, 
      // 앱에서 파일을 보낼 때 필드명을 'file'이 아닌 다른 걸로 보낸 겁니다.
      console.log('파일이 안 들어왔습니다!');
      throw new BadRequestException('파일이 없습니다.');
    }
    
    const s3Url = await this.inspectionService.uploadToS3(file, body.requestId, body.category);
    return { url: s3Url };
  }
}