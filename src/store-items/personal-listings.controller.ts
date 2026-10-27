import { Controller, Get, Param } from '@nestjs/common';
import { StoreItemsService } from './store-items.service';

// 개인 정찰제 매물 둘러보기 — 로그인·내부키 없이 완전 공개(웹 /market).
// 개인끼리 직접 거래하는 매물이라 딜러 경매(v1/external/store-items)와는 섞지 않는다.
// 거기엔 입찰가·에스크로처럼 일반 사용자에게 보이면 안 되는 값이 들어있다.
@Controller('v1/public/personal-listings')
export class PersonalListingsController {
  constructor(private readonly service: StoreItemsService) {}

  @Get()
  findAll() {
    return this.service.findPersonalListings();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOnePersonalListing(Number(id));
  }
}
