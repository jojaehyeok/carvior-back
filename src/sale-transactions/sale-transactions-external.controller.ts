import { Body, Controller, Get, Param, Query, Post, UseGuards } from '@nestjs/common';
import { SaleTransactionsService } from './sale-transactions.service';
import { InternalKeyGuard } from '../store-items/internal-key.guard';

// 딜러(브라우저)에서 직접 호출하는 엔드포인트 — 관리자 컨트롤러와 분리해서 딜러 화면에는
// 절대 다른 딜러 입찰금액/차주 개인정보가 섞여나갈 수 없게 함.
@UseGuards(InternalKeyGuard)
@Controller('v1/external')
export class SaleTransactionsExternalController {
  constructor(private readonly service: SaleTransactionsService) {}

  @Post('sale-listings/:id/bid')
  submitBid(
    @Param('id') id: string,
    @Body() body: { dealerId?: number; dealerName: string; amount: number },
  ) {
    return this.service.submitBid(Number(id), body.dealerId ?? null, body.dealerName, Number(body.amount));
  }

  @Get('sale-listings/:id/bids')
  findBids(@Param('id') id: string, @Query('dealerId') dealerId?: string) {
    return this.service.findBidsForDealer(Number(id), dealerId ? Number(dealerId) : undefined);
  }

  @Get('sale-bids/my')
  findMyBids(@Query('dealerId') dealerId: string) {
    return this.service.findMyBids(Number(dealerId));
  }

  @Get('sale-transactions/my')
  findMyTransactions(@Query('dealerId') dealerId: string) {
    return this.service.findMyTransactions(Number(dealerId));
  }
}
