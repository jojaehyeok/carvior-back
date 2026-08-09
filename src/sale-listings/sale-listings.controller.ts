import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SaleListingsService } from './sale-listings.service';
import { InternalKeyGuard } from '../store-items/internal-key.guard';

@Controller('v1/admin/sale-listings')
@UseGuards(InternalKeyGuard)
export class SaleListingsController {
  constructor(private readonly service: SaleListingsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(Number(id));
  }
}

// 딜러 회원(승인된 딜러 계정)이 판매차량 목록/상세를 보는 화면용 — 관리자 컨트롤러와
// 분리해서 차주 개인정보 필드(ownerName/ownerContact 등)가 실수로도 섞여 나갈 수 없게 함.
@Controller('v1/external/sale-listings')
@UseGuards(InternalKeyGuard)
export class SaleListingsExternalController {
  constructor(private readonly service: SaleListingsService) {}

  @Get()
  findAllForDealer() {
    return this.service.findAllForDealer();
  }

  @Get(':id')
  findOneForDealer(@Param('id') id: string) {
    return this.service.findOneForDealer(Number(id));
  }
}
