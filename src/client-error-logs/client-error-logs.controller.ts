import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { ClientErrorLogsService } from './client-error-logs.service';

@Controller('v1/client-error-logs')
export class ClientErrorLogsController {
  constructor(private readonly service: ClientErrorLogsService) {}

  @Post()
  async report(
    @Body() body: { driverId?: string; driverName?: string; screen: string; message: string },
  ) {
    await this.service.create(body);
    return { success: true };
  }

  @Get()
  async list(@Query('limit') limit?: string) {
    return await this.service.findRecent(limit ? Number(limit) : 50);
  }
}
