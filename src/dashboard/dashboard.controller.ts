import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('v1/dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get('stats')
  getStats() {
    return this.svc.getStats();
  }
}
