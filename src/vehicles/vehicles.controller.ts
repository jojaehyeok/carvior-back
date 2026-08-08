import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { Vehicle } from './entities/vehicle.entity';
import { InternalKeyGuard } from '../store-items/internal-key.guard';
import { SaleListingsService } from '../sale-listings/sale-listings.service';

@Controller('v1/admin/vehicles')
@UseGuards(InternalKeyGuard)
export class VehiclesController {
  constructor(
    private readonly service: VehiclesService,
    private readonly saleListingsService: SaleListingsService,
  ) {}

  @Get('unmatched')
  findUnmatched() {
    return this.service.findUnmatched();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Partial<Vehicle>) {
    return this.service.update(Number(id), body);
  }

  // 차주 판매동의(OWNER_AGREED_TO_SELL) 받은 차량을 판매매물(SaleListing)로 전환
  @Post(':id/create-listing')
  createListing(
    @Param('id') id: string,
    @Body() body: { askingPrice: number; minimumAcceptablePrice?: number },
  ) {
    return this.saleListingsService.createFromVehicle(Number(id), body);
  }
}
