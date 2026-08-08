import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PartnerApplicationsService } from './partner-applications.service';
import { InternalKeyGuard } from '../store-items/internal-key.guard';

@Controller('v1')
export class PartnerApplicationsController {
  constructor(private readonly service: PartnerApplicationsService) {}

  @Post('external/partner-applications')
  create(@Body() body: { name: string; phone: string; email?: string; companyName?: string; message?: string; qualifyingCount: number }) {
    return this.service.create(body);
  }

  // 마이페이지에서 로그인 유저의 신청/승인 상태를 배너에 반영하기 위한 공개 조회 API
  @Get('external/partner-applications/by-phone')
  findByPhone(@Query('phone') phone: string) {
    return this.service.findLatestByPhone(phone ?? '');
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
