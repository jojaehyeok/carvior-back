import {
  Controller,
  Post,
  Get,
  Body,
  Patch,
  Param,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';

class CreateBookingDto {
  carNumber!: string;
}

@Controller('v1/external/request')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  // ✅ GET: 차량 번호 중복 체크 (신청 가능 여부 확인)
  // 프론트엔드에서: https://carvior.store/api/v1/external/request/check-duplicate?carNumber=123가4567
  @Get('check-duplicate')
  async checkDuplicate(@Query('carNumber') carNumber: string) {
    if (!carNumber) {
      throw new BadRequestException('차량 번호를 입력해주세요.');
    }
    const isDuplicate =
      await this.bookingsService.checkOngoingBooking(carNumber);
    return {
      success: true,
      isDuplicate, // true면 이미 진행중인 예약이 있다는 뜻
    };
  }

  // POST: 간편 신청 저장
  @Post()
  async handleRequest(@Body() createBookingDto: CreateBookingDto) {
    // 🛑 POST 시점에서도 한 번 더 체크 (DB 무결성 방어)
    const isDuplicate = await this.bookingsService.checkOngoingBooking(
      createBookingDto.carNumber,
    );
    if (isDuplicate) {
      throw new BadRequestException('이미 진단 신청이 접수된 차량입니다.');
    }

    const result = await this.bookingsService.create(createBookingDto);
    return {
      success: true,
      message: '접수가 완료되었습니다.',
      data: result,
    };
  }

  @Get('my-list') // 경로는 /api/v1/bookings/my-list 로 바꿉니다.
  async getMyList(@Query('driverId') driverId: string) {
    return await this.bookingsService.findByDriver(driverId);
  }

  // PATCH: 예약 상태 업데이트 (진단사 취소 포함)
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: number,
    @Body() updateData: Partial<Booking> & { cancelReason?: string; cancelledByDriver?: boolean },
  ) {
    const updatedBooking = await this.bookingsService.update(id, updateData);
    return {
      success: true,
      message: '상태가 업데이트되었습니다.',
      data: updatedBooking,
    };
  }

  // GET: 진단사 취소 통계
  @Get('driver/:driverId/cancel-stats')
  async getDriverCancelStats(@Param('driverId') driverId: string) {
    return await this.bookingsService.getDriverCancelStats(driverId);
  }

  // GET: 전체 리스트 확인 (source 필터 옵션)
  // 예: /api/v1/external/request/list?source=anyone-motors
  @Get('list')
  async getList(@Query('source') source?: string) {
    return await this.bookingsService.findAll(source);
  }

  @Patch(':id/assign')
  async assignDriver(
    @Param('id') id: string,
    @Body() driverInfo: { id: string; name: string }, // ID와 이름을 객체로 받음
  ) {
    return await this.bookingsService.assign(Number(id), driverInfo);
  }
}
