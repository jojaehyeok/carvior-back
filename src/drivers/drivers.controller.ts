import { Controller, Post, Body, UploadedFile, UseInterceptors, Patch, Param } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DriversService } from './drivers.service';
import { diskStorage } from 'multer';
import { extname } from 'path';

@Controller('v1/drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Post('register')
  @UseInterceptors(FileInterceptor('licenseFile', {
    storage: diskStorage({
      destination: './uploads/licenses',
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, file.fieldname + '-' + uniqueSuffix + extname(file.originalname));
      },
    }),
  }))
  async register(@Body() driverInfo: any, @UploadedFile() file: Express.Multer.File) {
    return await this.driversService.create(driverInfo, file);
  }

  @Patch(':id/approve')
  async approve(@Param('id') id: string) {
    return await this.driversService.updateStatus(id, 'APPROVED');
  }
}