import { Controller, Post, Body, Get, Query, Patch, Param, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UsersService } from './users.service';
import { S3Service } from '../s3/s3.service';
import { InternalKeyGuard } from '../store-items/internal-key.guard';

@Controller('v1/users')
export class UsersController {
  constructor(
    private readonly svc: UsersService,
    private readonly s3: S3Service,
  ) {}

  @Post('upload-doc')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadDoc(@UploadedFile() file: Express.Multer.File) {
    const ext = file.originalname.split('.').pop();
    const key = `dealer-docs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const url = await this.s3.uploadFile(file, key);
    return { url };
  }

  @Post('upload-logo')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadLogo(@UploadedFile() file: Express.Multer.File) {
    const ext = file.originalname.split('.').pop();
    const key = `company-logos/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const url = await this.s3.uploadFile(file, key);
    return { url };
  }

  @Post('register')
  register(@Body() body: {
    email: string; password: string; name: string; phone?: string; role?: string; company?: string; logoUrl?: string;
    isExportOnly?: boolean; canConfirmBilling?: boolean; isPurchaseTeam?: boolean;
    dealerLicenseUrl?: string; businessRegUrl?: string; businessNumber?: string; companyName?: string;
    marketingConsent?: boolean;
  }) {
    return this.svc.register(body);
  }

  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.svc.login(body.email, body.password);
  }

  @Post('social')
  findOrCreate(@Body() body: { provider: string; providerId: string; email?: string; name?: string; profileImage?: string }) {
    return this.svc.findOrCreateSocial(body);
  }

  @Get('by-email')
  findByEmail(@Query('email') email: string) {
    return this.svc.findByEmail(email);
  }

  @Get()
  findAll() {
    return this.svc.findAll();
  }

  @Patch(':id/role')
  @UseGuards(InternalKeyGuard)
  updateRole(@Param('id') id: string, @Body() body: { role: string }) {
    return this.svc.updateRole(Number(id), body.role);
  }

  @Get('dealers')
  findDealers() {
    return this.svc.findDealers();
  }

  @Patch(':id/dealer-status')
  @UseGuards(InternalKeyGuard)
  updateDealerStatus(@Param('id') id: string, @Body() body: { dealerStatus: string }) {
    return this.svc.updateDealerStatus(Number(id), body.dealerStatus);
  }

  @Patch(':id/apply-dealer')
  @UseGuards(InternalKeyGuard)
  applyDealer(@Param('id') id: string, @Body() body: {
    dealerLicenseUrl: string; businessRegUrl?: string; businessNumber?: string; companyName?: string;
  }) {
    return this.svc.applyDealer(Number(id), body);
  }

  @Patch(':id/password')
  async updatePassword(@Param('id') id: string, @Body() body: { password: string }) {
    await this.svc.updatePassword(Number(id), body.password);
    return { success: true };
  }

  @Patch(':id/admin-info')
  updateAdminInfo(@Param('id') id: string, @Body() body: { name?: string; phone?: string; company?: string; logoUrl?: string; profileImage?: string; isExportOnly?: boolean }) {
    return this.svc.updateAdminInfo(Number(id), body);
  }

  @Patch(':id/push-token')
  async savePushToken(@Param('id') id: string, @Body('pushToken') pushToken: string) {
    await this.svc.updatePushToken(Number(id), pushToken);
    return { success: true };
  }

  // 관리자 대시보드에서 브라우저 알림 권한을 허용하면 받은 FCM 토큰을 여기로 저장한다.
  // 로그인한 본인 계정에만 저장하므로 별도 권한 가드는 두지 않는다(기존 push-token과 동일).
  // 슈퍼관리자 전용 — 대시보드 하드코딩 계정이라 :id가 숫자가 아니어서 아래 경로를 못 쓴다.
  // 반드시 ':id/web-push-token'보다 위에 있어야 'super-admin'이 :id로 잡히지 않는다.
  @Patch('super-admin/web-push-token')
  async saveSuperAdminWebPushToken(@Body('webPushToken') webPushToken: string) {
    await this.svc.updateSuperAdminWebPushToken(webPushToken);
    return { success: true };
  }

  @Patch(':id/web-push-token')
  async saveWebPushToken(@Param('id') id: string, @Body('webPushToken') webPushToken: string) {
    await this.svc.updateWebPushToken(Number(id), webPushToken);
    return { success: true };
  }

  @Patch(':id/marketing-consent')
  updateMarketingConsent(@Param('id') id: string, @Body() body: { marketingConsent: boolean }) {
    return this.svc.updateMarketingConsent(Number(id), !!body.marketingConsent);
  }

  @Get('admins')
  findAdmins() {
    return this.svc.findAdmins();
  }
}
