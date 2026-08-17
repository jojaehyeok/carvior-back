import { Controller, Get, Param } from '@nestjs/common';
import { StoreItemsService } from './store-items.service';

// 일반 고객용(신규 고객 앱) 매물 둘러보기 — 로그인/내부키 없이 완전 공개.
// 딜러 전용 컨트롤러(v1/external/store-items, v1/admin/store-items)와는 반드시
// 분리 유지 — 저기엔 입찰가/에스크로 등 고객에게 노출되면 안 되는 필드가 섞여있음.
@Controller('v1/public/store-items')
export class StoreItemsConsumerController {
  constructor(private readonly service: StoreItemsService) {}

  @Get()
  findActiveForPublic() {
    return this.service.findActiveForPublic();
  }

  @Get(':id')
  findOneForPublic(@Param('id') id: string) {
    return this.service.findOneForPublic(Number(id));
  }
}
