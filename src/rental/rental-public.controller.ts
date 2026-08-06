import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RentalService } from './rental.service';
import { InternalKeyGuard } from '../store-items/internal-key.guard';

// 딜러/승계희망자용 — 입찰 생성·조회는 대시보드/앱과 동일하게 x-internal-key 필요.
@Controller('v1/external/rental-listings')
export class RentalPublicController {
  constructor(private readonly service: RentalService) {}

  @Get(':id/bids')
  @UseGuards(InternalKeyGuard)
  findBids(@Param('id') id: string) {
    return this.service.findBidsByListing(Number(id));
  }

  @Post(':id/bid')
  @UseGuards(InternalKeyGuard)
  createBid(
    @Param('id') id: string,
    @Body() body: { bidderName: string; bidderContact?: string; requestedSubsidy: number },
  ) {
    return this.service.createBid(Number(id), body.bidderName, body.bidderContact, Number(body.requestedSubsidy));
  }
}

// 차주(렌트 소유자)용 — 무인증 토큰 접근, InternalKeyGuard 없음(토큰 자체가 인증).
@Controller('v1/external/my-rental')
export class MyRentalController {
  constructor(private readonly service: RentalService) {}

  @Get(':token')
  async getByToken(@Param('token') token: string) {
    const item = await this.service.findByToken(token);
    const bids = await this.service.findBidsByListing(item.id);
    const { sellerContact, ...safeItem } = item as any;
    return { item: safeItem, bids };
  }

  @Post(':token/request-match')
  requestMatch(@Param('token') token: string, @Body('bidId') bidId: number) {
    return this.service.requestMatch(token, Number(bidId));
  }
}
