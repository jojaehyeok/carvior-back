import { Controller, Post, Body, UploadedFile, UseInterceptors, Patch, Param, Get } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DriversService } from './drivers.service';
import { diskStorage } from 'multer'; // ✅ 추가
import { extname } from 'path'; // ✅ 추가
import { existsSync, mkdirSync } from 'fs'; // ✅ 추가

@Controller('v1/drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) { }

  @Post('register')
  @UseInterceptors(
    FileInterceptor('licenseFile', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = './uploads/licenses';
          if (!existsSync(uploadPath)) {
            mkdirSync(uploadPath, { recursive: true }); // 폴더 없으면 생성
          }
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `license-${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  async register(@Body() driverInfo: any, @UploadedFile() file: Express.Multer.File) {
    console.log('--- 요청 들어옴! ---');
    console.log('Body:', driverInfo);
    console.log('File:', file);
    return await this.driversService.create(driverInfo, file);
  }

  @Get() // 👈 아무것도 적지 않아야 /api/v1/drivers (GET) 경로가 생성됩니다!
  async findAll() {
    return this.driversService.findAll();
  }

  @Patch(':id/approve')
  async approve(@Param('id') id: string) {
    return await this.driversService.updateStatus(id, 'APPROVED');
  }
}