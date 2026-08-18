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

  @Get('listings')
  listings(
    @Query('manufacturer') manufacturer: string,
    @Query('model') model: string,
    @Query('badge') badge?: string,
  ) {
    if (!manufacturer || !model) return [];
    return this.service.listings(manufacturer, model, badge);
  }

  @Get('vehicle/:id')
  vehicleDetail(@Param('id') id: string) {
    return this.service.vehicleDetail(id);
  }
}
