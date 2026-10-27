import { Body, Controller, Headers, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ReportsService } from './reports.service';
import { userIdFromToken } from '../chat/chat-auth';

// 개인 직거래 신고 — 로그인한 사람만. 채팅과 같은 토큰을 쓴다.
@Controller('v1/reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly jwt: JwtService,
  ) {}

  @Post()
  create(
    @Headers('authorization') auth: string,
    @Body() body: { targetType: 'listing' | 'chat'; targetId: number; reason: string; detail?: string },
  ) {
    return this.reports.create(userIdFromToken(this.jwt, auth), body);
  }
}
