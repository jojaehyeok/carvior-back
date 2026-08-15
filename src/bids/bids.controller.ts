import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { BidsService } from './bids.service';
import { InternalKeyGuard } from '../store-items/internal-key.guard';

@Controller('v1')
export class BidsController {
  constructor(private readonly bidsService: BidsService) {}

  @Post('external/store-items/:id/bid')
  @UseGuards(InternalKeyGuard)
  create(
    @Param('id') id: string,
    @Body() body: { dealerId?: number; dealerName: string; amount: number },
  ) {
    return this.bidsService.create(Number(id), body.dealerId ?? null, body.dealerName, Number(body.amount));
  }

  @Get('external/store-items/:id/bids')
  @UseGuards(InternalKeyGuard)
  countByItem(@Param('id') id: string, @Query('dealerId') dealerId?: string) {
    return this.bidsService.countByItem(Number(id), dealerId ? Number(dealerId) : undefined);
  }

  // 딜러앱 "입찰한 물건" / "낙찰한 물건" 탭용
  @Get('external/bids/my')
  @UseGuards(InternalKeyGuard)
  findByDealer(@Query('dealerId') dealerId: string) {
    return this.bidsService.findByDealer(Number(dealerId));
  }

  // 딜러앱 — 낙찰 후 "네, 책임질 수 있는 견적입니다" 확인
  @Patch('external/store-items/:id/confirm-winner')
  @UseGuards(InternalKeyGuard)
  confirmWinner(@Param('id') id: string, @Body('dealerId') dealerId: number) {
    return this.bidsService.confirmWinner(Number(id), Number(dealerId));
  }

  // 딜러앱 — 낙찰 후 실물 확인 방문일정 입력
  @Patch('external/store-items/:id/visit-schedule')
  @UseGuards(InternalKeyGuard)
  scheduleVisit(@Param('id') id: string, @Body() body: { dealerId: number; visitScheduledAt: string }) {
    return this.bidsService.scheduleVisit(Number(id), Number(body.dealerId), body.visitScheduledAt);
  }

  // 딜러앱 — 방문 후 실물 확인 결과로 감가 신청
  @Patch('external/store-items/:id/price-adjustment')
  @UseGuards(InternalKeyGuard)
  requestPriceAdjustment(@Param('id') id: string, @Body() body: { dealerId: number; amount: number; reason: string }) {
    return this.bidsService.requestPriceAdjustment(Number(id), Number(body.dealerId), Number(body.amount), body.reason);
  }

  @Patch('admin/bids/:bidId/select-winner')
  @UseGuards(InternalKeyGuard)
  selectWinner(@Param('bidId') bidId: string) {
    return this.bidsService.selectWinner(Number(bidId));
  }

  // 딜바타 앱 — 입찰 전 정지 여부 확인
  @Get('external/dealers/:id/penalty-status')
  @UseGuards(InternalKeyGuard)
  async getPenaltyStatus(@Param('id') id: string) {
    return this.bidsService.getDealerPenaltyStatus(Number(id));
  }
}
