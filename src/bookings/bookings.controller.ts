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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';
import { S3Service } from '../s3/s3.service';
import { IntakeParserService } from './intake-parser.service';
import { OcrService } from 'src/ocr/ocr.service';
import { AdminGuard } from '../auth/admin.guard';
import { Public } from '../auth/public.decorator';

class CreateBookingDto {
  carNumber!: string;
}

/**
 * ⚠ 이 컨트롤러는 **기본이 관리자 전용**이다(AdminGuard).
 *
 * 전에는 가드가 하나도 없어서, 주소만 알면 누구나 차주 연락처·주소·매입가를 받아가고
 * 배정까지 바꿀 수 있었다. 지금은 반대로 뒤집어서, 공개로 열어야 하는 것만 @Public('이유')로
 * 연다 — 새로 추가하는 엔드포인트가 기본적으로 뚫려 있지 않게.
 *
 * AdminGuard는 `ADMIN_API_STRICT=true`일 때만 실제로 막는다. 그 전까지는 통과시키고
 * [admin-guard] 경고만 남긴다 — 돌고 있는 대시보드·평가사 앱을 한 번에 끊지 않으려고.
 * 로그에 경고가 안 찍히는 걸 확인한 다음 켠다.
 */
@UseGuards(AdminGuard)
@Controller('v1/external/request')
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly s3Service: S3Service,
    private readonly intakeParserService: IntakeParserService,
    private readonly ocrService: OcrService,
  ) {}

  // ✅ GET: 차량 번호 중복 체크 (신청 가능 여부 확인)
  // 프론트엔드에서: https://carvior.store/api/v1/external/request/check-duplicate?carNumber=123가4567
  @Public('고객 검차 신청 폼 — 로그인 전에 신청 가능 여부를 본다')
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
  @Public('고객 검차 신청 폼 — 예약 가능 시간대 조회')
  @Get('available-slots')
  async getAvailableSlots(@Query('address') address: string, @Query('date') date: string) {
    if (!address || !date) {
      throw new BadRequestException('주소와 날짜를 모두 입력해주세요.');
    }
    return this.bookingsService.getAvailableSlots(address, date);
  }

  // GET: 고객 셀프서비스 — 이름 또는 연락처 중 하나만 맞아도 본인 예약 조회(공개 API).
  // 신청 당시 입력한 이름/연락처를 둘 다 정확히 기억 못 하는 고객이 많아 OR 조건으로 완화함.
  @Public('고객 본인 접수 조회 — 로그인 계정이 없는 신청자가 쓴다')
  @Get('lookup-by-name')
  async lookupByName(@Query('name') name?: string, @Query('contact') contact?: string) {
    if (!name?.trim() && !contact?.trim()) throw new BadRequestException('이름 또는 연락처 중 하나는 입력해주세요.');
    return this.bookingsService.lookupByNameAndContact(name, contact);
  }

  // GET: 고객 셀프서비스 — 예약번호 + (연락처 또는 이름)로 본인 예약 조회(취소 전 확인 화면용, 공개 API)
  @Public('고객 본인 접수 조회 — 알림톡 링크로 들어온다')
  @Get(':id/lookup')
  async lookupForCustomer(@Param('id') id: string, @Query('contact') contact?: string, @Query('name') name?: string) {
    if (!contact?.trim() && !name?.trim()) throw new BadRequestException('이름 또는 연락처 중 하나는 입력해주세요.');
    return this.bookingsService.lookupForCustomer(Number(id), contact, name);
  }

  // PATCH: 고객 셀프서비스 취소 — 연락처 또는 이름으로 본인 확인 후 상태만 CANCELLED로 변경(환불은 관리자 수동 처리)
  @Public('고객 본인 취소 — 알림톡 링크')
  @Patch(':id/self-cancel')
  async selfCancel(@Param('id') id: string, @Body('contact') contact?: string, @Body('name') name?: string) {
    if (!contact?.trim() && !name?.trim()) throw new BadRequestException('이름 또는 연락처 중 하나는 입력해주세요.');
    return this.bookingsService.selfCancel(Number(id), contact, name);
  }

  // PATCH: 고객 셀프서비스 — 취소된 예약을 1시간 이내면 재결제 없이 날짜만 바꿔 재신청
  @Public('고객 본인 일정 변경 — 알림톡 링크')
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
  @Public('카비어 웹 구매자 화면 — 매물별 토큰으로 본인 확인')
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
  @Public('카비어 웹 구매자 화면 — 매물별 토큰으로 본인 확인')
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

  // POST: 딜러가 카톡으로 보낸 접수 내용을 간편신청 폼 항목으로 바꿔준다(자동 채우기 전용).
  // 저장은 하지 않는다 — 화면에서 사람이 확인하고 평소대로 제출한다.
  @Public('신청 폼 붙여넣기 파싱 — 저장하지 않고 글만 분해한다')
  @Post('parse-intake')
  async parseIntake(@Body('text') text: string) {
    return await this.intakeParserService.parse(text ?? '');
  }

  // POST: 카톡 화면 캡처·명함 사진에서 글자를 읽어 같은 방식으로 폼 항목을 만들어 준다.
  // 사진 1장당 CLOVA OCR 호출 1건이 과금되므로(월 100건 무료, 초과 시 건당 약 3원)
  // 글로 받은 내용은 위 parse-intake를 쓰고, 이 경로는 사진일 때만 쓴다.
  // 읽어낸 원문(text)도 함께 돌려줘서 화면에서 사람이 눈으로 확인·수정할 수 있게 한다.
  @Public('신청 폼 이미지 파싱 — 저장하지 않고 OCR만 돌린다')
  @Post('parse-intake/image')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage() }))
  async parseIntakeImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('사진이 없습니다.');
    const { text } = await this.ocrService.extractPlainText(file);
    if (!text.trim()) throw new BadRequestException('사진에서 글자를 읽지 못했습니다. 더 또렷한 사진으로 올려주세요.');
    return { ...this.intakeParserService.parse(text), text };
  }

  // POST: 계약서 미작성 건 가격 재안내 문자 — 딜러/차주를 골라 대상별 1회만 보낸다.
  // 문구는 서버에 고정돼 있어 화면에서 바꿔 보낼 수 없다(bookings.service.ts PRICE_FOLLOWUP_MESSAGES).
  @Post(':id/price-followup')
  async sendPriceFollowup(
    @Param('id') id: string,
    @Body() body: { sendToDealer?: boolean | string; sendToCustomer?: boolean | string; dealerPhone?: string; customerPhone?: string },
  ) {
    return this.bookingsService.sendPriceFollowup(Number(id), {
      sendToDealer: body.sendToDealer === true || body.sendToDealer === 'true',
      sendToCustomer: body.sendToCustomer === true || body.sendToCustomer === 'true',
      dealerPhone: body.dealerPhone,
      customerPhone: body.customerPhone,
    });
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
  @Public('고객·딜러 검차 신청 접수 — 로그인 없이 받는 것이 이 서비스의 입구다')
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
        ? '접수가 완료되었습니다. 다만 등록되지 않은 발주사 코드로 접수되어 자동 배정 전에 담당자와 협의가 필요합니다. 070-4138-2017로 연락 부탁드립니다.'
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
  //
  // ⚠ 평가사 앱이 배정 수락·취소에 쓴다. 앱에 토큰이 없어서 list와 같은 이유로 못 닫는다.
  @Public('평가사 앱(ChavatarApp) 배정 수락·취소 — 앱에 토큰을 넣기 전까지 닫을 수 없다')
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: number,
    @Body() updateData: Partial<Booking> & { cancelReason?: string; cancelledByDriver?: boolean; adminLogin?: string },
  ) {
    const updatedBooking = await this.bookingsService.update(id, updateData);
    return {
      success: true,
      message: '상태가 업데이트되었습니다.',
      data: updatedBooking,
    };
  }

  // PATCH: 매입팀이 [매입완료]를 눌렀을 때 — 같은 발주사 관리자(대표·사무장)에게 브라우저 알림
  @Patch(':id/purchase-complete')
  async markPurchaseComplete(@Param('id') id: string, @Body('userId') userId?: string) {
    // userId는 버튼을 누른 관리자 — 본인에게는 알림을 보내지 않기 위해 받는다.
    return await this.bookingsService.markPurchaseComplete(Number(id), userId ? Number(userId) : undefined);
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
  @Public('평가사 앱(ChavatarApp) — 진단 시트에서 확인 표시. 앱에 로그인 토큰이 없어서 아직 닫을 수 없다')
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

  // PATCH: 평가사가 진단 현장에서 탁송 가능 여부를 표시
  @Patch(':id/transport-status')
  async setTransportStatus(
    @Param('id') id: number,
    @Body() body: { driverId: string; status: 'AVAILABLE' | 'CONDITIONAL' | 'UNAVAILABLE'; reasons?: string[]; note?: string },
  ) {
    const updatedBooking = await this.bookingsService.setTransportStatus(id, body);
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

  // GET: 간편신청 폼의 딜러 이름 자동완성 — 지난 접수 기록에서 이름으로 찾아 연락처를 돌려준다.
  // 공개 폼에서 부르므로 발주사(source)를 반드시 받아 그 발주사 기록만 조회한다.
  @Public('카비어 웹 간편신청 화면 — 딜러 이름 자동완성')
  @Get('dealer-suggest')
  async suggestDealers(@Query('source') source: string, @Query('q') q: string) {
    return await this.bookingsService.suggestDealers(source, q);
  }

  // PATCH: 관리자가 묶음을 해제한다(접수 실수로 같은 장소에 두 번 신청된 경우 등).
  // 해제한 건은 나중에 같은 장소로 새 접수가 들어와도 다시 묶이지 않는다.
  @Patch(':id/unbundle')
  async unbundle(@Param('id') id: string) {
    return await this.bookingsService.unbundle(Number(id));
  }

  // POST: 평가사가 현장에서 같은 장소의 차량을 한 대 더 추가(묶음 진단).
  // 담당 진단사 본인만 가능하며, 원본 건의 방문지·일시·발주사를 그대로 복사해
  // 같은 묶음으로 붙인다. 자동배정을 다시 돌리지 않으므로 담당자도 그대로다.
  @Post(':id/bundle-vehicle')
  async addBundleVehicle(
    @Param('id') id: string,
    @Body() body: { driverId: string; carNumber: string; carOwner?: string; carModel?: string },
  ) {
    return await this.bookingsService.addBundleVehicle(Number(id), body.driverId, body);
  }

  // GET: 진단사 앱 "예약 요청" 탭 실시간 갱신용 초경량 폴링 엔드포인트.
  // 목록 전체(/list)는 수백 KB라 10초마다 받으면 현장 모바일 데이터가 감당이 안 된다 —
  // 대기건의 "지문"(개수/최대 id/최근 수정시각)만 내려주고, 값이 바뀐 순간에만 앱이
  // 실제 목록을 다시 부르게 한다. 반드시 아래 ":id" 라우트보다 위에 있어야 한다.
  @Get('request-pulse')
  async getRequestPulse() {
    return await this.bookingsService.getRequestPulse();
  }

  // GET: 전체 리스트 확인 (source 필터 옵션)
  // 예: /api/v1/external/request/list?source=anyone-motors
  // source 없이 조회 시 자체 신청(self-) 건은 기본 제외됨 — includeSelf=true로 명시하면 포함
  //
  // ⚠⚠ 이 컨트롤러에서 **실제로 민감한 자료가 새는 자리**가 여기다.
  // 주소만 알면 누구나 전 접수의 차주 연락처·주소·매입가·계약금을 받아갈 수 있다.
  //
  // 그런데 지금 닫을 수 없다 — 쓰는 곳이 셋인데 그중 하나가 인증을 못 보낸다:
  //   ① 대시보드            → 로그인 토큰을 보낼 수 있다(이번에 붙였다)
  //   ② 카비어 웹 서버 라우트 → 내부키를 보낼 수 있다(서버끼리라 안전하다)
  //   ③ 평가사 앱(ChavatarApp) → **로그인 토큰이 아예 없다.** 전체 목록을 받아서
  //      앱에서 currentDriverId로 거른다(app/(tabs)/index.tsx). 여기를 막으면
  //      평가사들이 그 자리에서 일을 못 한다.
  //
  // 그래서 ③에 평가사 토큰을 넣고 앱을 새로 올리는 것이 선행 조건이다. 그때까지 공개로 둔다.
  // 앱 배포(플레이 심사)가 걸린 일이라 이 커밋과 분리한다. 땜질로 민감 필드만 빼면
  // 앱이 쓰는 필드를 전부 확인해야 하고, 그것도 결국 앱 배포가 필요하다.
  @Public('평가사 앱이 인증 없이 쓴다 — 앱에 토큰을 넣기 전까지는 닫을 수 없다. 민감자료 유출 지점')
  @Get('list')
  async getList(@Query('source') source?: string, @Query('includeSelf') includeSelf?: string, @Query('contact') contact?: string) {
    return await this.bookingsService.findAll(source, includeSelf === 'true', contact);
  }

  // GET: 등록증 사진은 저장했지만 아직 딜러·고객 누구에게도 안 보낸 건 수(대시보드 메뉴 배지용).
  // 반드시 아래 ":id" 라우트보다 위에 있어야 한다.
  @Get('registration-pending-count')
  async getRegistrationPendingCount(@Query('source') source: string) {
    return await this.bookingsService.countRegistrationPending(source ?? '');
  }

  // GET: 전화번호로 개별(B2C) 완료건수 확인 — 파트너패널 제안 자격 체크용
  @Public('카비어 웹 파트너 패널 — 누적 건수 숫자만 내려준다')
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

  // GET: 주소로 출장비(거리 할증) 미리보기 — 딜러 출장검차 신청 폼이 쓴다.
  // 접수 전이라 예약이 아직 없으므로 주소만 받는다.
  @Public('카비어 웹 딜러검차 안내 화면 — 거리 기준 추가금 미리보기')
  @Get('distance-estimate')
  async getDistanceEstimate(@Query('address') address: string) {
    return await this.bookingsService.estimateDistanceSurcharge(address ?? '');
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

  // POST: 매물 참고자료 다시 받기 — 접수 때 링크가 없었거나 조회가 실패한 건을 수동으로
  @Post(':id/refresh-listing-data')
  async refreshListingData(@Param('id') id: string) {
    return await this.bookingsService.refreshListingData(Number(id));
  }

  // GET: 이 예약에서 가까운 순으로 진단사 후보 (대시보드 배정 칩)
  // 배정은 하지 않는다 — 관리자가 보고 고르라고 거리만 계산해서 준다.
  @Get(':id/nearby-drivers')
  async getNearbyDrivers(@Param('id') id: string) {
    return await this.bookingsService.findNearbyDrivers(Number(id));
  }

  @Patch(':id/assign')
  async assignDriver(
    @Param('id') id: string,
    @Body() driverInfo: { id: string; name: string }, // ID와 이름을 객체로 받음
  ) {
    return await this.bookingsService.assign(Number(id), driverInfo);
  }
}
