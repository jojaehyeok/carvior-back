import { Controller, Get, Param, Query } from '@nestjs/common';
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

  // 앱 무한스크롤용 — 카드에 그리는 값만, 커서(id)로 잘라서 내려준다.
  // 위 findAll()은 웹 /market이 쓰고 있어서 그대로 둔다(응답 모양이 다르다).
  //
  //   GET /v1/public/personal-listings/feed?limit=20
  //   GET /v1/public/personal-listings/feed?limit=20&cursor=<직전 응답의 nextCursor>
  @Get('feed')
  feed(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.service.findPersonalFeed({ cursor: Number(cursor), limit: Number(limit) });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOnePersonalListing(Number(id));
  }
}
