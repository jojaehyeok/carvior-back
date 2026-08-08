import { Body, Controller, Post } from '@nestjs/common';
import { InspectionPaymentsService } from './inspection-payments.service';

// v1/* 는 Apache가 항상 백엔드로 프록시해주는 경로라, 결제승인처럼 시크릿키가 필요한
// 서버사이드 로직은 반드시 여기(NestJS)에 둔다 — Next.js API 라우트는 화이트리스트에
// 없으면 404가 나는 인프라 이슈가 있었음.
@Controller('v1/external/inspection-payments')
export class InspectionPaymentsController {
  constructor(private readonly service: InspectionPaymentsService) {}

  @Post('confirm-toss')
  confirmToss(@Body() body: any) {
    return this.service.confirmToss(body);
  }

  @Post('confirm-naverpay')
  confirmNaverPay(@Body() body: any) {
    return this.service.confirmNaverPay(body);
  }
}
