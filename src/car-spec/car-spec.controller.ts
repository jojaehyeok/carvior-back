import { Controller, Get, Param, Query } from '@nestjs/common';
import { CarSpecService } from './car-spec.service';

@Controller('v1/external/car-spec')
export class CarSpecController {
  constructor(private readonly service: CarSpecService) {}

  @Get('search')
  search(@Query('q') q: string) {
    if (!q?.trim()) return [];
    return this.service.search(q.trim());
  }

  // 같은 모델그룹 안의 세대 목록(스포티지 → NQ5/더 볼드/4세대…). 세대마다 시세가 달라서
  // 프론트에서 세대를 고르게 하려고 쓴다.
  @Get('generations')
  generations(
    @Query('manufacturer') manufacturer: string,
    @Query('model') model: string,
    @Query('badge') badge?: string,
  ) {
    if (!manufacturer || !model) return [];
    return this.service.generations(manufacturer, model, badge);
  }

  // generation(세대)은 선택 — 안 주면 기존처럼 모델그룹 전체를 섞어서 본다.
  @Get('listings')
  listings(
    @Query('manufacturer') manufacturer: string,
    @Query('model') model: string,
    @Query('badge') badge?: string,
    @Query('generation') generation?: string,
  ) {
    if (!manufacturer || !model) return [];
    return this.service.listings(manufacturer, model, badge, generation);
  }

  // 매물 링크(엔카/KB차차차/케이카) → 기록부·진단 참고자료.
  // 평가사가 검차 가기 전에 보는 용도라 키는 서버에만 두고 여기로만 나간다.
  @Get('listing-lookup')
  listingLookup(@Query('url') url: string) {
    if (!url?.trim()) return { ok: false, reason: 'empty' };
    return this.service.listingLookup(url.trim());
  }

  @Get('vehicle/:id')
  vehicleDetail(@Param('id') id: string) {
    return this.service.vehicleDetail(id);
  }
}
