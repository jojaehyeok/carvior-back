import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('v1/users')
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  /** NextAuth 콜백에서 소셜 로그인 시 유저 find-or-create */
  @Post('social')
  findOrCreate(@Body() body: {
    provider: string;
    providerId: string;
    email?: string;
    name?: string;
    profileImage?: string;
  }) {
    return this.svc.findOrCreateSocial(body);
  }

  /** 이메일로 유저 조회 (Credentials provider 용) */
  @Get('by-email')
  findByEmail(@Query('email') email: string) {
    return this.svc.findByEmail(email);
  }

  /** 전체 유저 목록 (어드민 용) */
  @Get()
  findAll() {
    return this.svc.findAll();
  }
}
