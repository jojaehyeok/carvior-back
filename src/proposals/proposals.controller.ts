import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ProposalsService } from './proposals.service';
import { SolapiService } from '../solapi/solapi.service';

@Controller('v1/proposals')
export class ProposalsController {
  constructor(
    private readonly service: ProposalsService,
    private readonly solapiService: SolapiService,
  ) {}

  @Post()
  async create(@Body() body: {
    storeItemId: string;
    name: string;
    company?: string;
    contact: string;
    proposedUSD?: number;
    message?: string;
    carTitle?: string;
  }) {
    const proposal = await this.service.create({
      storeItemId: body.storeItemId,
      name: body.name,
      company: body.company,
      contact: body.contact,
      proposedUSD: body.proposedUSD,
      message: body.message,
    });

    try {
      const msg = [
        `[카비어 가격제안]`,
        `차량: ${body.carTitle ?? body.storeItemId}`,
        `제안자: ${body.name}${body.company ? ` (${body.company})` : ''}`,
        `연락처: ${body.contact}`,
        body.proposedUSD ? `제안가: $${body.proposedUSD.toLocaleString()}` : '',
        body.message ? `메시지: ${body.message}` : '',
      ].filter(Boolean).join('\n');
      await this.solapiService.sendSms('01022856017', msg);
    } catch { /* 알림 실패 무시 */ }

    return proposal;
  }

  @Get()
  async findByItem(@Query('itemId') itemId: string) {
    if (!itemId) return [];
    return this.service.findByItem(itemId);
  }

  @Get('count')
  async countByItem(@Query('itemId') itemId: string) {
    if (!itemId) return { count: 0 };
    const count = await this.service.countByItem(itemId);
    return { count };
  }

  @Get('all')
  findAll() {
    return this.service.findAll();
  }
}
