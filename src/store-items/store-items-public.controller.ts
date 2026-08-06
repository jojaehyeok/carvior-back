import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { StoreItemsService } from './store-items.service';
import { BidsService } from '../bids/bids.service';

// InternalKeyGuard 없이 토큰 자체가 인증 역할을 함 — 관리자 라우트와 섞이지 않게 별도 컨트롤러로 분리.
@Controller('v1/external/my-listing')
export class StoreItemsPublicController {
  constructor(
    private readonly storeItemsService: StoreItemsService,
    private readonly bidsService: BidsService,
  ) {}

  @Get(':token')
  async getByToken(@Param('token') token: string) {
    const item = await this.storeItemsService.findByToken(token);
    const bids = await this.bidsService.findByItem(item.id);
    const { adminMemo, sellerContact, ...safeItem } = item as any;
    return { item: safeItem, bids };
  }

  @Post(':token/request-sale')
  requestSale(@Param('token') token: string, @Body('bidId') bidId: number) {
    return this.storeItemsService.requestSale(token, Number(bidId));
  }
}
