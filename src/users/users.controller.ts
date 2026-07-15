import { Controller, Post, Body, Get, Query, Patch, Param, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UsersService } from './users.service';
import { S3Service } from '../s3/s3.service';

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

  @Post('register')
  register(@Body() body: {
    email: string; password: string; name: string; phone?: string; role?: string;
    dealerLicenseUrl?: string; businessRegUrl?: string; businessNumber?: string; companyName?: string;
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
  updateRole(@Param('id') id: string, @Body() body: { role: string }) {
    return this.svc.updateRole(Number(id), body.role);
  }

  @Patch(':id/password')
  async updatePassword(@Param('id') id: string, @Body() body: { password: string }) {
    await this.svc.updatePassword(Number(id), body.password);
    return { success: true };
  }

  @Get('admins')
  findAdmins() {
    return this.svc.findAdmins();
  }
}
