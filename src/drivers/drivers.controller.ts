import { Controller, Post, Body, UploadedFile, UseInterceptors, Patch, Param } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DriversService } from './drivers.service';
import { diskStorage } from 'multer';
import { extname } from 'path';

@Controller('v1/drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) { }

  @Post('register')
  @UseInterceptors(FileInterceptor('licenseFile'))
  async register(@Body() driverInfo: any, @UploadedFile() file: Express.Multer.File) {
    console.log('--- 요청 들어옴! ---'); // 👈 이게 터미널에 안 찍히면 Multer 설정 오류입니다.
    console.log('Body:', driverInfo);
    console.log('File:', file);
    return await this.driversService.create(driverInfo, file);
  }

  @Patch(':id/approve')
  async approve(@Param('id') id: string) {
    return await this.driversService.updateStatus(id, 'APPROVED');
  }
}