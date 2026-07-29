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

  // ✅ GET: 방문 주소·날짜 기준 예약 가능 시간대 조회 (헤이딜러처럼 실제 활동중인 평가사가
  // 있는 시간대만 고객에게 노출) — /inspection 결제 폼에서: /check-duplicate와 동일하게 공개 GET
  @Get('available-slots')
  async getAvailableSlots(@Query('address') address: string, @Query('date') date: string) {
    if (!address || !date) {
      throw new BadRequestException('주소와 날짜를 모두 입력해주세요.');
    }
    return this.bookingsService.getAvailableSlots(address, date);
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
      message: result.restricted
        ? '접수가 완료되었습니다. 다만 등록되지 않은 발주사 코드로 접수되어 자동 배정 전에 담당자와 협의가 필요합니다. 010-2285-6017로 연락 부탁드립니다.'
        : '접수가 완료되었습니다.',
      restricted: !!result.restricted,
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

  // PATCH: 관리자가 계좌이체 신청 건의 입금을 확인 — 그제서야 자동배정/브로드캐스트 진행
  @Patch(':id/confirm-deposit')
  async confirmDeposit(@Param('id') id: number) {
    const updatedBooking = await this.bookingsService.confirmDeposit(Number(id));
    return { success: true, data: updatedBooking };
  }

  // PATCH: 평가사 앱이 배정 건 상세화면을 열 때 호출 — 대시보드에서 "확인함/미확인" 표시용
  @Patch(':id/mark-seen')
  async markSeen(@Param('id') id: number, @Body() body: { driverId?: string }) {
    const updatedBooking = await this.bookingsService.markSeen(Number(id), body?.driverId);
    return { success: true, data: updatedBooking };
  }

  // PATCH: 관리자가 대기 건을 "긴급·당일배정"으로 전체 진단사에게 강제 브로드캐스트
  @Patch(':id/urgent-broadcast')
  async broadcastUrgent(@Param('id') id: number) {
    const updatedBooking = await this.bookingsService.broadcastUrgent(id);
    return { success: true, data: updatedBooking };
  }

  // PATCH: 에이전트 진단평가사가 대기 건을 다른 진단사에게 지정 배정
  @Patch(':id/agent-assign')
  async agentAssign(
    @Param('id') id: number,
    @Body() body: { agentDriverId: string; targetDriverId: string; targetDriverName: string },
  ) {
    const updatedBooking = await this.bookingsService.agentAssign(
      id, body.agentDriverId, body.targetDriverId, body.targetDriverName,
    );
    return { success: true, data: updatedBooking };
  }

  // PATCH: 일반 평가사가 담당 건 라운딩 요청
  @Patch(':id/request-rounding')
  async requestRounding(@Param('id') id: number, @Body() body: { driverId: string }) {
    const updatedBooking = await this.bookingsService.requestRounding(id, body.driverId);
    return { success: true, data: updatedBooking };
  }

  // PATCH: 진단/에이전트 등급이 라운딩 요청 수락
  @Patch(':id/accept-rounding')
  async acceptRounding(@Param('id') id: number, @Body() body: { driverId: string; driverName: string }) {
    const updatedBooking = await this.bookingsService.acceptRounding(id, { id: body.driverId, name: body.driverName });
    return { success: true, data: updatedBooking };
  }

  // GET: 진단사 취소 통계
  @Get('driver/:driverId/cancel-stats')
  async getDriverCancelStats(@Param('driverId') driverId: string) {
    return await this.bookingsService.getDriverCancelStats(driverId);
  }

  // GET: 전체 리스트 확인 (source 필터 옵션)
  // 예: /api/v1/external/request/list?source=anyone-motors
  // source 없이 조회 시 자체 신청(self-) 건은 기본 제외됨 — includeSelf=true로 명시하면 포함
  @Get('list')
  async getList(@Query('source') source?: string, @Query('includeSelf') includeSelf?: string) {
    return await this.bookingsService.findAll(source, includeSelf === 'true');
  }

  // GET: 진단사 취소 로그 목록 (CS 관리용, source 필터 옵션)
  @Get('cancel-logs')
  async getCancelLogs(@Query('source') source?: string) {
    return await this.bookingsService.findCancelLogs(source);
  }

  // GET: 대시보드 "발주사 관리" 탭 — 접수는 들어오는데 아직 관리자 계정이 없는 발주사 코드 목록
  @Get('unregistered-sources')
  async getUnregisteredSources() {
    return await this.bookingsService.findUnregisteredSources();
  }

  @Patch(':id/assign')
  async assignDriver(
    @Param('id') id: string,
    @Body() driverInfo: { id: string; name: string }, // ID와 이름을 객체로 받음
  ) {
    return await this.bookingsService.assign(Number(id), driverInfo);
  }
}
