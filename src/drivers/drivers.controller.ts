import { Controller, Post, Body, UploadedFile, UseInterceptors, Patch, Param, Get } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DriversService } from './drivers.service';
import { S3Service } from '../s3/s3.service';
import { memoryStorage } from 'multer';
import { extname } from 'path';

@Controller('v1/drivers')
export class DriversController {
  constructor(
    private readonly driversService: DriversService,
    private readonly s3Service: S3Service,
  ) { }

  @Post('register')
  @UseInterceptors(
    FileInterceptor('licenseFile', {
      storage: memoryStorage(),
    }),
  )
  async register(@Body() driverInfo: any, @UploadedFile() file: Express.Multer.File) {
    let licenseImageUrl: string | null = null;

    if (file) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const key = `licenses/license-${uniqueSuffix}${extname(file.originalname)}`;
      licenseImageUrl = await this.s3Service.uploadFile(file, key);
    }

    return await this.driversService.create(driverInfo, licenseImageUrl);
  }

  @Get()
  async findAll() {
    return this.driversService.findAll();
  }

  @Patch(':id/approve')
  async approve(@Param('id') id: string) {
    return await this.driversService.updateStatus(id, 'APPROVED');
  }

  @Patch(':id/reject')
  async reject(@Param('id') id: string) {
    return await this.driversService.updateStatus(id, 'REJECTED');
  }

  @Patch(':id/push-token')
  async savePushToken(@Param('id') id: string, @Body('pushToken') pushToken: string) {
    await this.driversService.savePushToken(Number(id), pushToken);
    return { success: true };
  }
}
