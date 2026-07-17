import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { InternalKeyGuard } from '../store-items/internal-key.guard';

// 자동차관리법 제65조의2제4항 3년 보관 기록 — 관리자(대시보드)만 조회
@Controller('v1/admin/compliance')
@UseGuards(InternalKeyGuard)
export class ComplianceController {
  constructor(private readonly service: ComplianceService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('by-plate/:plateNumber')
  findByPlate(@Param('plateNumber') plateNumber: string) {
    return this.service.findByPlate(plateNumber);
  }
}
