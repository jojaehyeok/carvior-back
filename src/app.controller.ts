import { Controller, Get, Post, Body } from '@nestjs/common';
import { AppService } from './app.service';
import { SolapiService } from './solapi/solapi.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly solapiService: SolapiService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // 셀프등록 새 매물 접수 시 관리자 SMS 알림
  @Post('v1/admin/notify/self-register')
  async notifySelfRegister(@Body() body: { carNumber: string; title: string; price: string; contact: string }) {
    const msg = `[카비어 셀프등록 신청]\n차량: ${body.title} (${body.carNumber})\n가격: ${body.price}만원\n연락처: ${body.contact}\n→ 대시보드에서 확인하세요`;
    await this.solapiService.sendSms('01022856017', msg);
    return { ok: true };
  }
}
