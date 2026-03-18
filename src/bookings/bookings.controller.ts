import { Controller, Post, Get, Body } from '@nestjs/common';
import { BookingsService } from './bookings.service';

@Controller('api/v1/external/request')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) { }

  // POST: 간편 신청 저장
  @Post()
  async handleRequest(@Body() createBookingDto: any) {
    const result = await this.bookingsService.create(createBookingDto);
    return {
      success: true,
      message: '접수가 완료되었습니다.',
      data: result,
    };
  }

  // NestJS: bookings.controller.ts 에 추가
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: number,
    @Body('status') status: string,
    @Body('adminMemo') adminMemo?: string
  ) {
    return await this.bookingsService.update(id, { status, adminMemo });
  }

  // GET: 전체 리스트 확인 (테스트용)
  @Get('list')
  async getList() {
    return await this.bookingsService.findAll();
  }
}