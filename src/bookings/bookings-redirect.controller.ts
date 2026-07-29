import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BookingsService } from './bookings.service';

// SMS 90byte 제한 안에 넣기 위한 짧은 리다이렉트 전용 컨트롤러 — 경로를 최대한 짧게 유지.
// 예: https://carvior.store/api/v1/r/123 → 실제 S3 등록증 이미지 URL로 302 리다이렉트
@Controller('v1/r')
export class BookingsRedirectController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get(':id')
  async redirectToRegistration(@Param('id') id: string, @Res() res: Response) {
    const url = await this.bookingsService.getTransferredRegistrationUrl(Number(id));
    return res.redirect(url);
  }
}
