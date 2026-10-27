import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { InternalKeyGuard } from '../store-items/internal-key.guard';

// 대시보드 "신고 관리" — 슈퍼관리자만 보는 화면이라 내부키로 막는다.
@UseGuards(InternalKeyGuard)
@Controller('v1/admin/reports')
export class ReportsAdminController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.reports.listForAdmin(status);
  }

  @Get('pending-count')
  async pendingCount() {
    return { count: await this.reports.countPending() };
  }

  @Patch(':id')
  handle(
    @Param('id') id: string,
    @Body() body: { status: 'resolved' | 'dismissed'; adminNote?: string; adminLogin?: string; hideListing?: boolean },
  ) {
    return this.reports.handle(Number(id), body);
  }
}
