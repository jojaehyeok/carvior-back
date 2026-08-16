import { Controller, Post, Body, UploadedFile, UseInterceptors, Patch, Delete, Param, Get, BadRequestException } from '@nestjs/common';
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

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.driversService.findById(Number(id));
  }

  // 회원 탈퇴 — 앱에서 진단사 본인이 비밀번호를 입력해 직접 계정을 삭제
  @Delete(':id')
  async remove(@Param('id') id: string, @Body('password') password: string) {
    return await this.driversService.remove(Number(id), password);
  }

  @Patch(':id/availability')
  async updateAvailability(@Param('id') id: string, @Body() body: any) {
    return this.driversService.updateAvailability(Number(id), body);
  }

  @Patch(':id/push-token')
  async savePushToken(@Param('id') id: string, @Body('pushToken') pushToken: string) {
    await this.driversService.savePushToken(Number(id), pushToken);
    return { success: true };
  }

  @Patch(':id/location')
  async updateLocation(@Param('id') id: string, @Body() body: { lat: number; lng: number }) {
    return this.driversService.updateLocation(Number(id), body.lat, body.lng);
  }

  // 진단사 본인이 앱에서 켜고 끄는 활동중지 스위치
  @Patch(':id/active-status')
  async setActiveStatus(@Param('id') id: string, @Body('isActive') isActive: boolean) {
    return this.driversService.setActiveStatus(Number(id), isActive);
  }

  // 등급 변경(일반/진단평가사/에이전트) — 관리자가 부여
  @Patch(':id/tier')
  async updateTier(@Param('id') id: string, @Body('tier') tier: 'general' | 'certified' | 'agent') {
    return this.driversService.updateTier(Number(id), tier);
  }

  // 진단리포트/평가사 소개용 프로필 사진 — 관리자가 대시보드 평가사 관리에서 등록/교체
  @Patch(':id/photo')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async updatePhoto(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('사진 파일이 없습니다.');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const key = `driver-photos/photo-${uniqueSuffix}${extname(file.originalname)}`;
    const photoUrl = await this.s3Service.uploadFile(file, key);
    return this.driversService.updatePhoto(Number(id), photoUrl);
  }

  @Get('locations/all')
  async findLocations() {
    return this.driversService.findLocations();
  }
}
