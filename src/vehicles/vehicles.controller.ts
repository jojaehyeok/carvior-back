import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { Vehicle } from './entities/vehicle.entity';
import { InternalKeyGuard } from '../store-items/internal-key.guard';

@Controller('v1/admin/vehicles')
@UseGuards(InternalKeyGuard)
export class VehiclesController {
  constructor(private readonly service: VehiclesService) {}

  @Get('unmatched')
  findUnmatched() {
    return this.service.findUnmatched();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Partial<Vehicle>) {
    return this.service.update(Number(id), body);
  }
}
