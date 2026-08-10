import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { SettlementExtraCostService } from './settlement-extra-cost.service';
import { InternalKeyGuard } from '../store-items/internal-key.guard';

@Controller('v1/admin/settlement-extra-cost')
@UseGuards(InternalKeyGuard)
export class SettlementExtraCostController {
  constructor(private readonly service: SettlementExtraCostService) {}

  @Get()
  async get(@Query('source') source: string, @Query('month') month: string) {
    const amount = await this.service.get(source, month);
    return { source, month, amount };
  }

  @Patch()
  set(@Body('source') source: string, @Body('month') month: string, @Body('amount') amount: number) {
    return this.service.set(source, month, Number(amount) || 0);
  }
}
