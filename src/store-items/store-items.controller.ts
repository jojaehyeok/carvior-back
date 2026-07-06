import { Controller, Get, Post, Patch, Delete, Body, Query, NotFoundException } from '@nestjs/common';
import { StoreItemsService } from './store-items.service';
import { StoreItem } from './entities/store-item.entity';
import { SolapiService } from '../solapi/solapi.service';

@Controller('v1/admin/store-items')
export class StoreItemsController {
  constructor(
    private readonly service: StoreItemsService,
    private readonly solapiService: SolapiService,
  ) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('my')
  findByUser(@Query('userId') userId: string) {
    return this.service.findByUser(Number(userId));
  }

  @Post()
  async create(@Body() body: Partial<StoreItem>) {
    const item = await this.service.create(body);

    // 관리자 알림 SMS
    try {
      const priceMan = item.priceKRW ? Math.round(Number(item.priceKRW) / 10_000) : 0;
      const contact = item.adminMemo?.match(/연락처:([^\s/\n]+)/)?.[1]?.trim() ?? '';
      const msg = `[카비어]${item.carNumber} ${priceMan}만 ${contact}`;
      await this.solapiService.sendSms('01022856017', msg);
    } catch {
      // 알림 실패해도 등록은 정상 처리
    }

    return item;
  }

  @Patch()
  async update(@Query('id') id: string, @Body() body: Partial<StoreItem>) {
    if (!id) throw new NotFoundException('id 파라미터가 필요합니다.');
    return this.service.update(Number(id), body);
  }

  @Delete()
  async remove(@Query('id') id: string) {
    if (!id) throw new NotFoundException('id 파라미터가 필요합니다.');
    await this.service.remove(Number(id));
    return { ok: true };
  }
}
