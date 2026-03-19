import { Controller, Post, Get, Body, Patch, Param } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';

@Controller('v1/external/request')
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

  // PATCH: 예약 상태 및 진단사 배정 업데이트
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: number,
    @Body() updateData: Partial<Booking> // status, assignedDriverId, adminMemo 등 포함
  ) {
    // 1. DB 업데이트 수행
    const updatedBooking = await this.bookingsService.update(id, updateData);

    // 2. [추가 포인트] 상태가 'CONFIRMED'로 바뀔 때 알림톡 발송 로직을 여기서 트리거하면 좋습니다.
    // if (updateData.status === 'CONFIRMED') {
    //   await this.bookingsService.sendAlimTalk(id, '진단사배정');
    // }

    return {
      success: true,
      message: '상태가 업데이트되었습니다.',
      data: updatedBooking,
    };
  }

  // GET: 전체 리스트 확인
  @Get('list')
  async getList() {
    return await this.bookingsService.findAll();
  }
}