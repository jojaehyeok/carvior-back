import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, NotFoundException } from '@nestjs/common';
import { RentalService } from './rental.service';
import { RentalListing } from './entities/rental-listing.entity';
import { InternalKeyGuard } from '../store-items/internal-key.guard';

@Controller('v1/admin/rental-listings')
@UseGuards(InternalKeyGuard)
export class RentalController {
  constructor(private readonly service: RentalService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(Number(id));
  }

  @Post()
  create(@Body() body: Partial<RentalListing>) {
    return this.service.create(body);
  }

  @Patch()
  update(@Query('id') id: string, @Body() body: Partial<RentalListing>) {
    if (!id) throw new NotFoundException('id 파라미터가 필요합니다.');
    return this.service.update(Number(id), body);
  }

  @Delete()
  async remove(@Query('id') id: string) {
    if (!id) throw new NotFoundException('id 파라미터가 필요합니다.');
    await this.service.remove(Number(id));
    return { ok: true };
  }

  @Get(':id/bids')
  findBids(@Param('id') id: string) {
    return this.service.findBidsByListing(Number(id));
  }
}

@Controller('v1/admin/rental-bids')
@UseGuards(InternalKeyGuard)
export class RentalBidsAdminController {
  constructor(private readonly service: RentalService) {}

  @Patch(':bidId/select-winner')
  selectWinner(@Param('bidId') bidId: string) {
    return this.service.selectWinner(Number(bidId));
  }
}
