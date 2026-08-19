import {
  Controller,
  Post,
  Get,
  Body,
  Patch,
  Delete,
  Param,
  BadRequestException,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';
import { S3Service } from '../s3/s3.service';

class CreateBookingDto {
  carNumber!: string;
}

@Controller('v1/external/request')
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly s3Service: S3Service,
  ) {}

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

  // GET: 고객 셀프서비스 — 이름 또는 연락처 중 하나만 맞아도 본인 예약 조회(공개 API).
  // 신청 당시 입력한 이름/연락처를 둘 다 정확히 기억 못 하는 고객이 많아 OR 조건으로 완화함.
  @Get('lookup-by-name')
  async lookupByName(@Query('name') name?: string, @Query('contact') contact?: string) {
    if (!name?.trim() && !contact?.trim()) throw new BadRequestException('이름 또는 연락처 중 하나는 입력해주세요.');
    return this.bookingsService.lookupByNameAndContact(name, contact);
  }

  // GET: 고객 셀프서비스 — 예약번호 + (연락처 또는 이름)로 본인 예약 조회(취소 전 확인 화면용, 공개 API)
  @Get(':id/lookup')
  async lookupForCustomer(@Param('id') id: string, @Query('contact') contact?: string, @Query('name') name?: string) {
    if (!contact?.trim() && !name?.trim()) throw new BadRequestException('이름 또는 연락처 중 하나는 입력해주세요.');
    return this.bookingsService.lookupForCustomer(Number(id), contact, name);
  }

  // PATCH: 고객 셀프서비스 취소 — 연락처 또는 이름으로 본인 확인 후 상태만 CANCELLED로 변경(환불은 관리자 수동 처리)
  @Patch(':id/self-cancel')
  async selfCancel(@Param('id') id: string, @Body('contact') contact?: string, @Body('name') name?: string) {
    if (!contact?.trim() && !name?.trim()) throw new BadRequestException('이름 또는 연락처 중 하나는 입력해주세요.');
    return this.bookingsService.selfCancel(Number(id), contact, name);
  }

  // PATCH: 고객 셀프서비스 — 취소된 예약을 1시간 이내면 재결제 없이 날짜만 바꿔 재신청
  @Patch(':id/reschedule')
  async reschedule(
    @Param('id') id: string,
    @Body('contact') contact?: string,
    @Body('name') name?: string,
    @Body('preferredDateTime') preferredDateTime?: string,
  ) {
    if (!contact?.trim() && !name?.trim()) throw new BadRequestException('이름 또는 연락처 중 하나는 입력해주세요.');
    if (!preferredDateTime?.trim()) throw new BadRequestException('희망일시를 선택해주세요.');
    return this.bookingsService.reschedule(Number(id), contact, name, preferredDateTime);
  }

  // PATCH: 신청자(대부분 구매예정자) 본인이 마이페이지에서 "구매완료" 셀프 표시/해제
  @Patch(':id/buyer-purchase-status')
  async updateBuyerPurchaseStatus(
    @Param('id') id: string,
    @Body('contact') contact?: string,
    @Body('name') name?: string,
    @Body('completed') completed?: boolean,
  ) {
    if (!contact?.trim() && !name?.trim()) throw new BadRequestException('이름 또는 연락처 중 하나는 입력해주세요.');
    return this.bookingsService.updateBuyerPurchaseStatus(Number(id), contact, !!completed, name);
  }

  // PATCH: 완전히 구매해서 본인 상사에서 따로 팔 예정 — 마이페이지 목록에서 숨김
  @Patch(':id/buyer-hidden')
  async updateBuyerHidden(
    @Param('id') id: string,
    @Body('contact') contact?: string,
    @Body('name') name?: string,
    @Body('hidden') hidden?: boolean,
  ) {
    if (!contact?.trim() && !name?.trim()) throw new BadRequestException('이름 또는 연락처 중 하나는 입력해주세요.');
    return this.bookingsService.updateBuyerHidden(Number(id), contact, !!hidden, name);
  }

  // POST: 발주사(대시보드)가 명의이전 완료된 등록증 사진을 직접 업로드 — 애니원모터스 등 전용
  // 딜러/고객 전송 여부는 각각 체크박스로 선택하며, 둘 다 선택하지 않으면 SMS 없이 사진만
  // 교체된다(등록증을 잘못 올린 경우 재업로드 — 이미 보낸 단축링크가 새 사진으로 그대로 반영됨)
  @Post(':id/transferred-registration')
  @UseInterceptors(FileInterceptor('photo', { storage: memoryStorage() }))
  async uploadTransferredRegistration(
    @Param('id') id: string,
    @Body('message') message?: string,
    @Body('sendToDealer') sendToDealer?: string,
    @Body('sendToCustomer') sendToCustomer?: string,
    @Body('dealerPhone') dealerPhone?: string,
    @Body('customerPhone') customerPhone?: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    // 이미 올려둔 사진이 있으면 새로 첨부하지 않고도 나머지 대상에게 보낼 수 있어야 하므로
    // photo는 선택사항 — 사진이 아예 없는 최초 전송인지는 서비스단에서 booking 상태로 판단
    let url: string | undefined;
    if (file) {
      const key = `transferred-registrations/${id}/${Date.now()}${extname(file.originalname)}`;
      url = await this.s3Service.uploadFile(file, key);
    }
    return this.bookingsService.saveTransferredRegistration(Number(id), url, message, {
      sendToDealer: sendToDealer === 'true',
      sendToCustomer: sendToCustomer === 'true',
      dealerPhone,
      customerPhone,
    });
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

  // PATCH: 슈퍼관리자가 주소/희망일시 수정 후 배정을 초기화하고 자동배정을 다시 시도
  // (기존 담당자 페널티 없음 — 프론트에서 슈퍼관리자에게만 노출)
  @Patch(':id/retry-auto-assign')
  async retryAutoAssign(
    @Param('id') id: string,
    @Body() body: { address?: string; preferredDateTime?: string },
  ) {
    const updatedBooking = await this.bookingsService.retryAutoAssign(Number(id), body);
    return { success: true, data: updatedBooking };
  }

  // PATCH: 평가사 앱이 배정 건 상세화면을 열 때 호출 — 대시보드에서 "확인함/미확인" 표시용
  @Patch(':id/mark-seen')
  async markSeen(@Param('id') id: number, @Body() body: { driverId?: string }) {
    const updatedBooking = await this.bookingsService.markSeen(Number(id), body?.driverId);
    return { success: true, data: updatedBooking };
  }

  // PATCH: 진단사가 확정문자(방문 일정/준비사항 안내)를 고객 또는 딜러에게 보냈을 때 기록
  @Patch(':id/confirm-message-sent')
  async markConfirmMessageSent(@Param('id') id: number, @Body('target') target: 'customer' | 'dealer') {
    const updatedBooking = await this.bookingsService.markConfirmMessageSent(Number(id), target);
    return { success: true, data: updatedBooking };
  }

  // PATCH: 진단사가 "상세정보(제원/시세)"에서 등급 선택/재선택(취소) — spec이 없으면 초기화
  @Patch(':id/car-spec')
  async setCarSpec(
    @Param('id') id: number,
    @Body() body: {
      manufacturer?: string; model?: string; badge?: string;
      rangeLow?: number; rangeHigh?: number;
      depLow?: number; depHigh?: number; depPct?: number;
    },
  ) {
    const spec =
      body?.manufacturer && body?.model
        ? { manufacturer: body.manufacturer, model: body.model, badge: body.badge ?? '' }
        : null;
    const estimate = spec
      ? {
          rangeLow: body.rangeLow, rangeHigh: body.rangeHigh,
          depLow: body.depLow, depHigh: body.depHigh, depPct: body.depPct,
        }
      : null;
    const updatedBooking = await this.bookingsService.setCarSpec(Number(id), spec, estimate);
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
  async getList(@Query('source') source?: string, @Query('includeSelf') includeSelf?: string, @Query('contact') contact?: string) {
    return await this.bookingsService.findAll(source, includeSelf === 'true', contact);
  }

  // GET: 전화번호로 개별(B2C) 완료건수 확인 — 파트너패널 제안 자격 체크용
  @Get('individual-count')
  async getIndividualCount(@Query('phone') phone: string) {
    const count = await this.bookingsService.countIndividualCompletedByPhone(phone ?? '');
    return { count };
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

  // GET: 슈퍼관리자용 — 현재 활성(만료 안 된) 진단사 페널티/우대 목록
  @Get('driver-penalties')
  async getDriverPenalties() {
    return await this.bookingsService.listDriverPenalties();
  }

  // GET: 단건 조회(관리자용) — 대시보드 매입가 산출 페이지처럼 예약 하나만 필요할 때.
  // 반드시 위의 고정 경로(list/individual-count 등)들 다음에 와야 ":id"가 그것들을 가로채지 않는다.
  @Get(':id')
  async getOne(@Param('id') id: string) {
    return await this.bookingsService.findOne(Number(id));
  }

  // POST: 슈퍼관리자가 진단사에게 수동으로 페널티/우대 부여
  @Post('driver-penalty')
  async createDriverPenalty(
    @Body() body: { driverId: string; type: 'penalty' | 'advantage'; days?: number; reason?: string },
  ) {
    if (!body.driverId || !body.type) {
      throw new BadRequestException('driverId와 type이 필요합니다.');
    }
    return await this.bookingsService.createDriverPenalty(body);
  }

  // DELETE: 페널티/우대 건 삭제
  @Delete('driver-penalty/:id')
  async deleteDriverPenalty(@Param('id') id: string) {
    return await this.bookingsService.deleteDriverPenalty(parseInt(id));
  }

  @Patch(':id/assign')
  async assignDriver(
    @Param('id') id: string,
    @Body() driverInfo: { id: string; name: string }, // ID와 이름을 객체로 받음
  ) {
    return await this.bookingsService.assign(Number(id), driverInfo);
  }
}
