import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { BidsService } from './bids.service';
import { InternalKeyGuard } from '../store-items/internal-key.guard';

@Controller('v1')
export class BidsController {
  constructor(private readonly bidsService: BidsService) {}

  @Post('external/store-items/:id/bid')
  @UseGuards(InternalKeyGuard)
  create(
    @Param('id') id: string,
    @Body() body: { dealerId?: number; dealerName: string; amount: number },
  ) {
    return this.bidsService.create(Number(id), body.dealerId ?? null, body.dealerName, Number(body.amount));
  }

  @Get('external/store-items/:id/bids')
  @UseGuards(InternalKeyGuard)
  findByItem(@Param('id') id: string) {
    return this.bidsService.findByItem(Number(id));
  }

  @Patch('admin/bids/:bidId/select-winner')
  @UseGuards(InternalKeyGuard)
  selectWinner(@Param('bidId') bidId: string) {
    return this.bidsService.selectWinner(Number(bidId));
  }
}
