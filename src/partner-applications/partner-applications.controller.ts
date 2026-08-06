import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PartnerApplicationsService } from './partner-applications.service';
import { InternalKeyGuard } from '../store-items/internal-key.guard';

@Controller('v1')
export class PartnerApplicationsController {
  constructor(private readonly service: PartnerApplicationsService) {}

  @Post('external/partner-applications')
  create(@Body() body: { name: string; phone: string; email?: string; companyName?: string; message?: string; qualifyingCount: number }) {
    return this.service.create(body);
  }

  @Get('admin/partner-applications')
  @UseGuards(InternalKeyGuard)
  findAll() {
    return this.service.findAll();
  }

  @Patch('admin/partner-applications/:id')
  @UseGuards(InternalKeyGuard)
  updateStatus(@Param('id') id: string, @Body('status') status: 'pending' | 'approved' | 'rejected') {
    return this.service.updateStatus(Number(id), status);
  }
}
