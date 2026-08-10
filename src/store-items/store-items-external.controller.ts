import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { StoreItemsService } from './store-items.service';
import { InternalKeyGuard } from './internal-key.guard';

// 딜바타(딜러 전용 앱) "경매장" 탭 — 관리자 컨트롤러(v1/admin/store-items)와 분리해서
// adminMemo/sellerContact 같은 딜러에게 노출되면 안 되는 필드가 섞여나갈 수 없게 함.
@Controller('v1/external/store-items')
@UseGuards(InternalKeyGuard)
export class StoreItemsExternalController {
  constructor(private readonly service: StoreItemsService) {}

  @Get()
  findActiveForDealer() {
    return this.service.findActiveForDealer();
  }

  @Get(':id')
  findOneForDealer(@Param('id') id: string) {
    return this.service.findOneForDealer(Number(id));
  }
}
