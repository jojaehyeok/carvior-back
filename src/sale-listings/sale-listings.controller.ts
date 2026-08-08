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
