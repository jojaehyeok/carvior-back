/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { SolapiService } from '../solapi/solapi.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Driver } from '../drivers/entities/driver.entity';
import { DriverCancelLog } from '../driver-cancel-logs/driver-cancel-log.entity';
import { Inspection } from '../inspection/entities/inspection.entity';
import { User } from '../users/entities/user.entity';
import { SmsBillingLog } from '../sms-billing-logs/sms-billing-log.entity';
import { DriverAssignmentPenalty } from '../driver-assignment-penalties/driver-assignment-penalty.entity';
import { ReviewsService } from '../reviews/reviews.service';
import { distanceKm, geocodeAddress, isDriverActiveNow, isLocationFresh, regionMatchDrivers } from './auto-assign.util';

// cavior 내에서 source 값을 고정 문자열로 보내는 B2C 신청 경로들 — 이 값들은
// 발주사 코드가 아니라서 관리자 등록 여부 체크 대상에서 제외한다.
const KNOWN_B2C_SOURCES = new Set([
  'SNS_PROMOTION',
  'EXPORT_SCRAP_QUOTE',
  'EVALUATOR_RECRUIT',
  'CARVIOR_INSPECTION',
  'INSPECTION',
  'SIMPLE_FORM',
  'PRIVATE_DEAL_FORM',
  // 딜바타(딜러 앱) "제휴검차" 탭 — 딜러 본인이 개인적으로 사려는 차량을 검차 신청
  'DEALER_PARTNER_INSPECTION',
]);

// 자동배정은 "지금 이 순간 활성 상태인 진단사"만 보고 판단하는 즉시배정 로직이라,
// 방문일이 접수 시점보다 한참 뒤인 예약건에 적용하면 실제 방문일의 스케줄과 무관하게
// 배정되거나 반대로 충분히 가능한 진단사가 제외될 수 있다 — 이 기간을 넘는 예약은
// 자동배정·전체 브로드캐스트를 건너뛰고 관리자가 대시보드에서 직접 배정하게 둔다.
const AUTO_ASSIGN_DAYS_THRESHOLD = 7;

// 배정 관련 알림(자동/수동/에이전트 배정)은 NotificationsService.sendPush의 기본음
// ("배정되었습니다")을 그대로 씀. 미배정 신규요청 브로드캐스트만 예외로 다른 채널/음을 씀
// (ChavatarApp app/(tabs)/index.tsx의 채널 정의와 매칭).
const PUSH_CHANNEL_NEW_REQUEST = { channelId: 'cavior-new-request', sound: 'carvior_new_request' };

// 관리자가 이미 배정된 건의 정보(고객번호/관리자메모 등)를 나중에 수정했을 때, 담당
// 진단사에게 "확인해주세요" 알림을 보내는 전용 채널 — 배정 알림과는 성격이 달라서
// (급한 신규건 알림이 아니라 참고용 정보 갱신) 차분한 별도음으로 구분한다.
const PUSH_CHANNEL_BOOKING_UPDATED = { channelId: 'cavior-booking-updated', sound: 'carvior_booking_updated' };

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(Driver)
    private readonly driverRepository: Repository<Driver>,
    @InjectRepository(DriverCancelLog)
    private readonly cancelLogRepository: Repository<DriverCancelLog>,
    @InjectRepository(Inspection)
    private readonly inspectionRepository: Repository<Inspection>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(SmsBillingLog)
    private readonly smsBillingLogRepository: Repository<SmsBillingLog>,
    @InjectRepository(DriverAssignmentPenalty)
    private readonly assignmentPenaltyRepository: Repository<DriverAssignmentPenalty>,
    private readonly solapiService: SolapiService,
    private readonly notificationsService: NotificationsService,
    private readonly reviewsService: ReviewsService,
  ) {}

  async checkOngoingBooking(carNumber: string): Promise<boolean> {
    const cleanCarNumber = carNumber.replace(/\s/g, '');
    // 간편신청에서 차량번호를 모를 때 "미정"으로 자동 접수되는데, 이건 실제 차량번호가
    // 아니라서 여러 건이 같은 값을 가져도 중복이 아니다 — 중복체크 자체를 건너뛴다.
    if (cleanCarNumber === '미정') return false;
    const existing = await this.bookingRepository.findOne({
      where: {
        carNumber: cleanCarNumber,
        status: Not(In(['COMPLETED', 'CANCELLED'])),
      },
    });
    return !!existing;
  }

  // B2B 간편신청(/marketing/simple-request/[company])은 URL의 company 값을 그대로 source로
  // 받아서 QR·링크로 공개 배포되므로, 등록된 발주사 관리자 계정이 없는 임의 코드로도 접수 자체는
  // 막지 않되(관리자가 신규 발주사인지 스팸인지 육안 확인 가능해야 함) 진단사 자동배정·전체 브로드캐스트는
  // 하지 않는다 — 검증 안 된 출처의 건이 실제 진단사에게 바로 배차되는 것을 막기 위함.
  private async isRestrictedSource(source?: string): Promise<boolean> {
    if (!source || KNOWN_B2C_SOURCES.has(source)) return false;
    // "self-{company}"(발주사 자체 보유 차량 접수)는 등록된 발주사 계정이 있으면
    // 정상 출처로 인정 — 접두사를 떼고 원래 회사코드로 재확인
    const company = source.startsWith('self-') ? source.slice(5) : source;
    if (KNOWN_B2C_SOURCES.has(company)) return false;
    const admin = await this.userRepository.findOne({ where: { role: 'admin', company } });
    return !admin;
  }

  // preferredDateTime("YYYY-MM-DD HH:mm")의 날짜가 오늘(KST) 기준 AUTO_ASSIGN_DAYS_THRESHOLD일
  // 이내인지 확인 — 날짜 파싱이 안 되면(형식이 다르거나 미입력) 기존처럼 즉시배정 대상으로 취급
  private isWithinAutoAssignWindow(preferredDateTime?: string): boolean {
    const datePart = preferredDateTime?.split(' ')[0];
    const match = datePart?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return true;
    const targetMidnight = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayKstMidnight = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate());

    const diffDays = Math.round((targetMidnight - todayKstMidnight) / 86400000);
    return diffDays <= AUTO_ASSIGN_DAYS_THRESHOLD;
  }

  async create(data: Partial<Booking>): Promise<Booking & { restricted?: boolean }> {
    // 계좌이체 신청은 버튼만 누르면 여기로 들어와서 실제 입금 여부를 알 수 없다 —
    // depositConfirmed를 false로 강제해두고, 관리자가 confirmDeposit()을 호출하기 전까지
    // 자동배정/브로드캐스트를 보류한다. 그 외(카드 결제 성공 콜백, 일반 접수 등)는 그대로 true.
    const pendingDeposit = data.paymentMethod === 'BANK_TRANSFER';
    const booking = this.bookingRepository.create({ ...data, depositConfirmed: !pendingDeposit });
    // 딜러 접수폼(간편신청/당근/검차 등)은 전부 요청사항을 additionalMemo로 보내는데, 대시보드는
    // adminMemo만 표시·검색해서 접수 시점에 적은 요청사항이 관리자 눈에 안 띄는 문제가 있었다 —
    // adminMemo가 따로 없으면 접수 시 additionalMemo를 그대로 넣어 대시보드에 바로 보이게 한다.
    if (!booking.adminMemo && data.additionalMemo) {
      booking.adminMemo = data.additionalMemo;
    }
    let saved = await this.bookingRepository.save(booking);

    const restricted = await this.isRestrictedSource(saved.source);
    // "self-{company}"는 발주사가 자기 소유 차량을 자체적으로 처리하는 건 —
    // 진단사가 실제로 방문할 필요가 없으니 자동배정도, 전체 브로드캐스트 알림도 하지 않는다.
    // (미등록 출처라서 막는 "restricted"와는 다른 개념 — 정상 등록된 발주사의 의도적 셀프 처리)
    const selfSource = !!saved.source?.startsWith('self-');

    if (restricted) {
      console.log(`⛔ [배정제한] 등록되지 않은 발주사 코드(source=${saved.source}) — 자동배정·진단사 브로드캐스트 건너뜀 (건: ${saved.carNumber})`);
    } else if (selfSource) {
      console.log(`ℹ️ [자체 진단] ${saved.carNumber} — 자체 신청 건이라 진단사 자동배정/알림 없이 접수만 처리`);
    } else if (pendingDeposit) {
      console.log(`💰 [입금 확인 대기] ${saved.carNumber} — 계좌이체 신청, 관리자 입금 확인 전까지 배정 보류`);
    } else {
      saved = await this.runAssignmentFlow(saved);
    }

    // 오지/준오지·긴급후보 뱃지용 거리 진단 — 미등록 발주사 건은 어차피 관리자가 별도로
    // 확인해야 하니 제외, 그 외엔 자동배정 성공 여부와 무관하게 항상 계산해둔다.
    if (!restricted) {
      await this.refreshDistanceFlags(saved);
    }

    // 관리자(01022856017)에게 새 예약 접수 알림톡 발송 — 건당 비용이 드는 유료 채널이라
    // 미등록 발주사(스팸/테스트 가능성 있는 건)는 여기서 제외하고 무료 로그로만 남긴다.
    // 실제 문의가 오면 대시보드 전체 목록에서 source 값으로 확인 가능(레코드는 정상 저장됨).
    if (restricted) {
      console.log(`🔕 [관리자 알림톡 생략] 미등록 발주사(source=${saved.source}) — 대시보드에서 확인 필요 (건: ${saved.carNumber})`);
      return { ...saved, restricted: true };
    }
    try {
      const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      await this.solapiService.sendReservationAlimTalk('01022856017', {
        '#{dealerName}': '관리자',
        '#{carNumber}': saved.carNumber,
        '#{carOwner}': saved.contact || '미입력',
        '#{preferredDate}': saved.preferredDateTime || '미입력',
        '#{createdAt}': now,
      });
      console.log(`✅ [관리자 알림톡] 새 예약 접수 → 01022856017 (${saved.carNumber})`);
    } catch (e) {
      console.error('❌ [관리자 알림톡 실패]', (e as Error).message);
    }

    return { ...saved, restricted: false };
  }

  // create()와 confirmDeposit() 양쪽에서 쓰는 공용 배정 로직 — 방문일이 너무 먼 건 관리자
  // 수동배정 대기로 넘기고, 아니면 지역·가용시간 맞는 진단사에게 즉시 자동배정, 없으면 전체
  // 진단사 브로드캐스트로 폴백한다. saved(최신 상태 반영된 booking)를 반환한다.
  private async runAssignmentFlow(saved: Booking): Promise<Booking> {
    if (!this.isWithinAutoAssignWindow(saved.preferredDateTime)) {
      console.log(`📅 [자동배정 보류] ${saved.carNumber} — 방문일(${saved.preferredDateTime})이 ${AUTO_ASSIGN_DAYS_THRESHOLD}일 이후라 자동배정/브로드캐스트 없이 관리자 수동배정 대기`);
      return saved;
    }

    // 지역·가용시간 맞는 활성 진단사가 있으면 즉시 자동배정, 없으면 기존처럼 전체 브로드캐스트로 폴백
    let assignedDriver: Driver | null = null;
    let assignLog: Record<string, unknown> | null = null;
    try {
      const result = await this.tryAutoAssign(saved);
      assignedDriver = result?.driver ?? null;
      assignLog = result?.log ?? null;
      if (!assignedDriver) {
        console.log(`ℹ️ [자동배정 대상 없음] ${saved.carNumber} (${saved.address}) — 전체 브로드캐스트로 폴백`);
      }
    } catch (e) {
      // 자동배정 실패는 접수 자체를 막으면 안 됨 — 아래 폴백(전체 브로드캐스트)으로 처리하되,
      // 원인 파악 가능하도록 에러는 반드시 로그로 남긴다(예전엔 조용히 삼켜서 디버깅이 불가능했음)
      console.error(`❌ [자동배정 실패] ${saved.carNumber}`, (e as Error).message);
    }

    if (assignedDriver) {
      saved = await this.assign(saved.id, { id: String(assignedDriver.id), name: assignedDriver.name }, 'auto');
      if (assignLog) {
        await this.bookingRepository.update(saved.id, { autoAssignLog: assignLog } as any);
        saved.autoAssignLog = assignLog;
      }
      console.log(`🤖 [자동배정] ${saved.carNumber} → ${assignedDriver.name}(${assignedDriver.id})`);
    } else {
      // 자동배정 대상이 없으면 승인된 진단사 전원에게 새 접수 푸시 발송(기존 동작) —
      // 활동중지로 꺼둔 진단사는 굳이 알림도 안 감
      try {
        const drivers = await this.driverRepository.find({
          where: { status: 'APPROVED', isActive: true },
        });
        // 위치가 30분 이상 오래된(사실상 이탈한) 진단사에게는 알림도 굳이 안 보냄
        const pushTargets = drivers.filter(d => d.pushToken && isLocationFresh(d));
        await Promise.all(
          pushTargets.map(d =>
            this.notificationsService.sendPush(
              d.pushToken,
              '새로운 진단 요청이 있습니다 📋',
              `접수 장소: ${saved.address}`,
              { bookingId: saved.id },
              PUSH_CHANNEL_NEW_REQUEST,
            ),
          ),
        );
      } catch (e) {
        // 푸시 실패해도 예약 저장은 정상 처리
      }
    }

    return saved;
  }

  // 관리자가 대시보드에서 "입금 확인" 버튼을 눌렀을 때 호출 — 계좌이체 신청 건(depositConfirmed=false)만
  // 대상이며, 확인 처리 후 그제서야 자동배정/브로드캐스트를 진행한다.
  async confirmDeposit(id: number): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) throw new NotFoundException('해당 신청 내역을 찾을 수 없습니다.');
    if (booking.paymentMethod !== 'BANK_TRANSFER') {
      throw new BadRequestException('계좌이체 신청 건이 아닙니다.');
    }
    if (booking.depositConfirmed) return booking; // 이미 확인 처리된 건 — 중복 클릭 방지

    booking.depositConfirmed = true;
    let saved = await this.bookingRepository.save(booking);
    saved = await this.runAssignmentFlow(saved);
    return saved;
  }

  // 슈퍼관리자가 대시보드에서 주소·희망일시를 수정한 뒤 "자동배정 재시도"를 눌렀을 때 호출.
  // 배정을 먼저 초기화(assignedDriverId: null)한 뒤 runAssignmentFlow()를 다시 태우므로,
  // assign() 내부의 "auto→manual 재배정 페널티" 조건(현재 assignedDriverId가 남아있어야 발동)이
  // 걸리지 않는다 — 관리자가 사유 있는 조건 변경으로 재배정하는 것이지 기존 담당자 잘못이 아니기 때문.
  async retryAutoAssign(id: number, updates: { address?: string; preferredDateTime?: string }): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) throw new NotFoundException('해당 신청 내역을 찾을 수 없습니다.');

    if (updates.address?.trim()) booking.address = updates.address.trim();
    if (updates.preferredDateTime?.trim()) booking.preferredDateTime = updates.preferredDateTime.trim();
    booking.status = 'PENDING';
    booking.assignedDriverId = null;
    booking.assignedDriverName = null;
    booking.cancelledByDriverAt = null;

    let saved = await this.bookingRepository.save(booking);
    await this.refreshDistanceFlags(saved);
    saved = await this.runAssignmentFlow(saved);
    return saved;
  }

  // 평가사 앱이 배정된 건의 상세화면을 열 때 호출 — 최초 1회만 기록(이미 확인한 건 재호출돼도
  // 시각을 덮어쓰지 않음). driverId를 함께 받아 실제 배정된 담당자가 맞는지 확인하고,
  // 배정 해제·재배정 등으로 이미 다른 사람 건이 됐으면 조용히 무시한다.
  async findOne(id: number): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) throw new NotFoundException('해당 신청 내역을 찾을 수 없습니다.');
    return booking;
  }

  // 진단사가 확정문자를 고객 또는 딜러에게 보냈을 때 호출 — "진단 시작" 게이트 해제용.
  // 이미 보낸 적 있어도 다시 보내면 최신 시각/대상으로 갱신한다.
  async markConfirmMessageSent(id: number, target: 'customer' | 'dealer'): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) throw new NotFoundException('해당 신청 내역을 찾을 수 없습니다.');
    booking.confirmMessageSentAt = new Date();
    booking.confirmMessageSentTo = target;
    return this.bookingRepository.save(booking);
  }

  async markSeen(id: number, driverId?: string): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) throw new NotFoundException('해당 신청 내역을 찾을 수 없습니다.');
    if (driverId && String(booking.assignedDriverId) !== String(driverId)) return booking;
    if (booking.driverSeenAt) return booking; // 이미 확인 기록됨
    booking.driverSeenAt = new Date();
    return this.bookingRepository.save(booking);
  }

  // 진단사가 "상세정보(제원/시세)"에서 등급을 고르거나 취소(재선택)할 때 호출.
  // spec이 null이면 세 컬럼 모두 비워서 재검색 상태로 되돌린다.
  // estimate는 그 시점에 앱이 계산한 시세 추정치(+사고감가 반영치) — 관리자 대시보드가
  // 재계산 없이 그대로 보여주는 용도. spec이 null이면 같이 비운다.
  async setCarSpec(
    id: number,
    spec: { manufacturer: string; model: string; badge: string } | null,
    estimate?: {
      rangeLow?: number; rangeHigh?: number;
      depLow?: number; depHigh?: number; depPct?: number;
    } | null,
  ): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) throw new NotFoundException('해당 신청 내역을 찾을 수 없습니다.');
    booking.carSpecManufacturer = spec?.manufacturer ?? null;
    booking.carSpecModel = spec?.model ?? null;
    booking.carSpecBadge = spec?.badge ?? null;
    booking.estPriceLow = spec ? estimate?.rangeLow ?? null : null;
    booking.estPriceHigh = spec ? estimate?.rangeHigh ?? null : null;
    booking.estPriceDepLow = spec ? estimate?.depLow ?? null : null;
    booking.estPriceDepHigh = spec ? estimate?.depHigh ?? null : null;
    booking.estPriceDepPct = spec ? estimate?.depPct ?? null : null;
    return this.bookingRepository.save(booking);
  }

  // 특히 당일 접수(긴급) 건들이 30분 간격으로 다닥다닥 들어올 때, 같은 진단사가 물리적으로
  // 이동·진단을 마칠 시간도 없이 겹쳐서 자동배정되는 걸 막기 위한 최소 간격
  private readonly MIN_SLOT_GAP_MINUTES = 60;

  // driverId가 이미 배정/확정/완료된 건 중 같은 날짜(preferredDateTime 기준)에 이 방문시각과
  // MIN_SLOT_GAP_MINUTES보다 가까운 게 있으면 true — 물리적으로 겹치는 시간대라 후보에서 제외해야 함
  private async hasScheduleConflict(driverId: number, preferredDateTime?: string | null): Promise<boolean> {
    // 소스마다 구분자가 달라("YYYY-MM-DD HH:mm" vs "YYYY-MM-DDTHH:mm:ss") 공백만 받으면
    // T구분자 건(예: /inspection 직접신청)의 충돌 체크가 항상 조용히 스킵되던 버그 — [ T] 둘 다 허용
    const match = preferredDateTime?.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
    if (!match) return false; // 시간 형식 파싱 안 되면(미입력 등) 충돌 체크 없이 기존처럼 진행
    const [, datePart, hh, mm] = match;
    const targetMinutes = Number(hh) * 60 + Number(mm);

    const sameDayBookings = await this.bookingRepository.find({
      where: {
        assignedDriverId: String(driverId),
        status: In(['ASSIGNED', 'CONFIRMED', 'COMPLETED']),
        preferredDateTime: Like(`${datePart}%`),
      },
      select: ['preferredDateTime'],
    });

    return sameDayBookings.some(b => {
      const m = b.preferredDateTime?.match(/(\d{2}):(\d{2})/);
      if (!m) return false;
      const otherMinutes = Number(m[1]) * 60 + Number(m[2]);
      return Math.abs(otherMinutes - targetMinutes) < this.MIN_SLOT_GAP_MINUTES;
    });
  }

  // 진단 배정 알림톡의 "오늘 총 진단건수" — 이 건의 방문일(preferredDateTime 날짜) 기준으로
  // 해당 진단사에게 배정/확정/완료된 건수를 센다(취소된 건 제외, 이 건 본인도 포함해서 카운트).
  private async countBookingsOnSameDay(driverId: string, preferredDateTime?: string | null): Promise<number> {
    const datePart = preferredDateTime?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    if (!datePart) return 1; // 날짜 파싱 안 되면 이 건 하나만 있는 것으로 표시
    return this.bookingRepository.count({
      where: {
        assignedDriverId: driverId,
        status: In(['ASSIGNED', 'CONFIRMED', 'COMPLETED']),
        preferredDateTime: Like(`${datePart}%`),
      },
    });
  }

  // /inspection 결제 폼의 방문시간 슬롯과 동일한 목록(30분 단위, 09:00~17:00)
  private readonly PUBLIC_BOOKING_TIME_SLOTS = [
    '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
    '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00',
  ];

  // 고객용 방문시간 미리보기(헤이딜러 스타일) — /inspection 폼에서 방문 주소+날짜를 고르면
  // 그 지역을 커버하는 활성 평가사가 실제로 그 시간대에 뛸 수 있는지(지역매칭+스케줄+같은
  // 60분 충돌버퍼) 확인해서 "예약 가능한 시간대"만 노출한다. tryAutoAssign()과 동일한 기준을
  // 그대로 재사용해 "미리보기엔 가능했는데 실제 접수 후 자동배정은 실패"하는 불일치를 막는다.
  // (isLocationFresh는 "지금 이 순간" GPS 활동 여부라 며칠 뒤 방문예정 슬롯엔 의미가 없어 제외)
  async getAvailableSlots(
    address: string,
    date: string,
  ): Promise<{
    regionCovered: boolean;
    slots: { time: string; available: boolean }[];
    activeDrivers: { name: string; rating: number; reviewCount: number; highlight: string | null; photoUrl: string | null; completedCount: number }[];
  }> {
    const drivers = await this.driverRepository.find({ where: { status: 'APPROVED', isActive: true } });
    // isActive(활동중지) 여부와 무관하게 "이 지역을 담당하는 평가사가 존재하는가"만 먼저 판단 —
    // 전부 활동중지 상태여도 (2)는 true로 남겨서 "서비스 미제공 지역"과 "오늘은 다 쉬는 중"을 구분한다
    const allApprovedDrivers = drivers.concat(await this.driverRepository.find({ where: { status: 'APPROVED', isActive: false } }));

    let regionMatched = regionMatchDrivers(drivers, address);
    let anyDriverCoversRegion = regionMatchDrivers(allApprovedDrivers, address).length > 0;
    // 텍스트 매칭으로 아무도 못 찾으면(시/도 없이 등록된 주소) 지오코딩 폴백으로 한 번 더 —
    // tryAutoAssign()과 동일한 기준이어야 "미리보기엔 안 됐는데 실제 접수는 자동배정됨" 같은
    // 불일치가 안 생긴다.
    if (!anyDriverCoversRegion) {
      const geocoded = await geocodeAddress(address);
      if (geocoded) {
        regionMatched = regionMatchDrivers(drivers, address, geocoded);
        anyDriverCoversRegion = regionMatchDrivers(allApprovedDrivers, address, geocoded).length > 0;
      }
    }
    if (regionMatched.length === 0) {
      return {
        regionCovered: anyDriverCoversRegion,
        slots: this.PUBLIC_BOOKING_TIME_SLOTS.map(time => ({ time, available: false })),
        activeDrivers: [],
      };
    }

    const slots = await Promise.all(
      this.PUBLIC_BOOKING_TIME_SLOTS.map(async time => {
        const preferredDateTime = `${date} ${time}`;
        const scheduleOk = regionMatched.filter(d => isDriverActiveNow(d, preferredDateTime));
        if (scheduleOk.length === 0) return { time, available: false };

        const conflictChecks = await Promise.all(
          scheduleOk.map(d => this.hasScheduleConflict(d.id, preferredDateTime)),
        );
        return { time, available: conflictChecks.some(conflict => !conflict) };
      }),
    );
    // 신청 페이지에 "이 지역에 활동 중인 평가사님이 있어요" 후킹 카드용 — 실제 리뷰 평점(리뷰
    // 없으면 5점 기본)과 축약 후기 한 줄, 프로필 사진(미등록 시 null → 프론트에서 로고로 대체),
    // 누적 진단 완료 건수(전체 기간)를 붙인다(getDriverStats/getDriverHighlight 참고).
    const activeDrivers = await Promise.all(
      regionMatched.map(async d => {
        const stats = await this.reviewsService.getDriverStats(String(d.id));
        const highlight = await this.reviewsService.getDriverHighlight(String(d.id));
        const completedCount = await this.bookingRepository.count({
          where: { assignedDriverId: String(d.id), status: 'COMPLETED' },
        });
        return { name: d.name, rating: stats.average, reviewCount: stats.total, highlight, photoUrl: d.photoUrl || null, completedCount };
      }),
    );
    return { regionCovered: true, slots, activeDrivers };
  }

  // 편도 거리 기준 [준오지/오지] 분류 임계값 — 준오지는 발주사 가격협상 검토 대상,
  // 오지는 왕복 거리가 커서 사실상 항상 가격협상이 필요한 수준
  private readonly SEMI_REMOTE_KM = 25;
  private readonly REMOTE_KM = 50;

  // 접수 시점에 1회 계산해서 저장하는 거리 진단 — 배정 로직에는 전혀 관여하지 않고,
  // 대시보드에 "오지/준오지"·"긴급후보" 뱃지를 표시해 관리자가 수동으로 판단(가격협상, 긴급브로드캐스트)하도록
  // 돕는 참고 정보일 뿐이다. 자동으로 관리자메모를 쓰거나 브로드캐스트를 트리거하지 않는다.
  private async computeDistanceFlags(booking: Booking): Promise<{
    nearestDriverKm: number | null;
    remoteTier: 'semi_remote' | 'remote' | null;
    urgentCandidate: boolean;
  }> {
    const drivers = await this.driverRepository.find({ where: { status: 'APPROVED' } });
    if (drivers.length === 0) {
      return { nearestDriverKm: null, remoteTier: null, urgentCandidate: false };
    }

    let nearestDriverKm: number | null = null;
    const coords = await geocodeAddress(booking.address);
    if (coords) {
      // 배정된 진단사가 있으면(ASSIGNED/CONFIRMED/COMPLETED) "가장 가까운 진단사" 일반 스냅샷 대신
      // 실제로 방문할 그 사람 기준 거리를 쓴다 — 배정 시점 이후 다른 사람이 배정되거나 위치가
      // 바뀌면 스냅샷이 낡아져서, 실제로는 먼 진단사가 배정됐는데도 "안 멂"으로 남는 문제가 있었다.
      const assignedDriver = booking.assignedDriverId
        ? await this.driverRepository.findOne({ where: { id: Number(booking.assignedDriverId) } })
        : null;

      if (assignedDriver?.lat != null && assignedDriver?.lng != null) {
        nearestDriverKm = Math.round(distanceKm(coords.lat, coords.lng, assignedDriver.lat, assignedDriver.lng) * 10) / 10;
      } else if (!booking.assignedDriverId) {
        // 아직 배정 전(PENDING)인 건은 기존처럼 "지금 가장 가까운 활성 진단사" 추정치를 참고용으로 쓴다.
        // isActive=false거나 위치 갱신이 오래 멈춘(오래된 자리에 고정된) 진단사까지 포함되면 실제로는
        // 아무도 근처에 없는데 거리가 가짜로 가깝게 나와 오지/준오지 판정이 빠지는 문제가 있었다 —
        // 실제 배정 로직(tryAutoAssign)과 동일하게 걸러준다.
        const withLocation = drivers.filter(d => d.lat != null && d.lng != null && d.isActive && isLocationFresh(d));
        if (withLocation.length > 0) {
          const nearest = Math.min(
            ...withLocation.map(d => distanceKm(coords.lat, coords.lng, d.lat!, d.lng!)),
          );
          nearestDriverKm = Math.round(nearest * 10) / 10;
        }
      }
    }

    const remoteTier: 'semi_remote' | 'remote' | null =
      nearestDriverKm == null
        ? null
        : nearestDriverKm >= this.REMOTE_KM
          ? 'remote'
          : nearestDriverKm >= this.SEMI_REMOTE_KM
            ? 'semi_remote'
            : null;

    // 긴급후보: 방문예정일이 접수 당일(KST 기준)인데, 지역이 맞는 진단사는 있지만
    // 그중 지금 활동중(스케줄+isActive+위치신선도)인 사람이 아무도 없는 경우 —
    // 자동배정도 실패하고 일반 브로드캐스트(활동중 대상만)도 아무에게도 안 갈 수 있는 상황
    const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const visitYmd = booking.preferredDateTime?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    const isToday = !!visitYmd && visitYmd === kstToday;

    const regionMatched = drivers.filter(d => (d.regions ?? []).some(r => r && booking.address?.includes(r)));
    const activeMatched = regionMatched
      .filter(d => isDriverActiveNow(d, booking.preferredDateTime))
      .filter(isLocationFresh);
    const urgentCandidate = isToday && regionMatched.length > 0 && activeMatched.length === 0;

    return { nearestDriverKm, remoteTier, urgentCandidate };
  }

  // computeDistanceFlags()는 접수 시점에만 계산되던 1회성 스냅샷이라, 그 뒤로 진단사 위치가
  // 바뀌면 저장된 오지/준오지 뱃지가 낡은 값이 됐다. 배정이 다시 정해지는 시점(취소 후 재대기,
  // 관리자 재배정 등)마다 이걸 다시 불러서 그 시점 기준 최신 위치로 갱신한다.
  private async refreshDistanceFlags(booking: Booking): Promise<void> {
    try {
      const flags = await this.computeDistanceFlags(booking);
      if (flags.nearestDriverKm != null || flags.urgentCandidate) {
        await this.bookingRepository.update(booking.id, flags);
        Object.assign(booking, flags);
      }
    } catch (e) {
      console.error('❌ [거리진단 계산 실패]', (e as Error).message);
    }
  }

  // 신청 주소·가용시간에 맞는 활성 진단사를 찾아 자동배정 대상을 고른다.
  // 지역이 맞는 진단사가 아무도 없으면 null을 반환해 기존 수동배정(전체 브로드캐스트) 흐름으로 넘긴다 —
  // 엉뚱한 지역 진단사에게 억지로 배정하는 것보다 관리자가 판단하게 두는 게 안전하기 때문.
  private async tryAutoAssign(booking: Booking): Promise<{ driver: Driver; log: Record<string, unknown> } | null> {
    // isActive: false — 진단사 본인이 앱에서 "활동중지"로 꺼둔 경우(원거리 이동 중 등)
    // 근무시간(스케줄)에 걸려도 자동배정 대상에서 아예 제외
    const drivers = await this.driverRepository.find({ where: { status: 'APPROVED', isActive: true } });
    if (drivers.length === 0) return null;

    // 진단사가 설정한 지역(구/시 단위) 중 하나라도 신청 주소 문자열에 포함되면 매칭으로 간주.
    // 텍스트 매칭이 아무도 못 찾으면(예: "그대로 등록하기"로 시/도 없이 저장된 주소) 지오코딩
    // 폴백으로 한 번 더 시도 — 아래 거리 계산용 geocodeAddress 호출과 결과를 공유해 중복 호출 방지.
    let regionMatched = regionMatchDrivers(drivers, booking.address);
    let geocodedForRegion: Awaited<ReturnType<typeof geocodeAddress>> = null;
    if (regionMatched.length === 0) {
      geocodedForRegion = await geocodeAddress(booking.address);
      if (geocodedForRegion) regionMatched = regionMatchDrivers(drivers, booking.address, geocodedForRegion);
    }
    if (regionMatched.length === 0) return null;

    // 지역은 맞는데 뒤 단계에서 조용히 걸러진 진단사 — "왜 이 사람은 후보에 없냐"는 문의가
    // 나올 때 배정근거 로그만 보고 원인을 바로 알 수 있게 기록해둔다(candidates에는 최종
    // 후보만 남으므로, 여긴 별도로 excluded에 담아 로그에 함께 저장).
    const excluded: Array<{ driverId: number; driverName: string; reason: string }> = [];

    // 근무시간·isActive를 통과해도 최근 30분간 위치 갱신이 없으면(앱 강제종료·백그라운드
    // 스로틀링 등으로 실제로 이탈했을 가능성) 자동배정 후보에서 제외
    const activeMatched = regionMatched.filter(d => {
      if (!isDriverActiveNow(d, booking.preferredDateTime)) {
        excluded.push({ driverId: d.id, driverName: d.name, reason: '방문예정시각이 근무 스케줄(요일/시간) 밖' });
        return false;
      }
      if (!isLocationFresh(d)) {
        excluded.push({ driverId: d.id, driverName: d.name, reason: '위치정보 갱신이 24시간 이상 오래됨' });
        return false;
      }
      return true;
    });
    if (activeMatched.length === 0) return null;

    // 같은 진단사가 같은 날 방문예정시각이 너무 가까운(MIN_SLOT_GAP_MINUTES 이내) 건을 동시에
    // 뛸 수 없으므로, 이미 그 시간대 근처에 배정된 건이 있는 진단사는 이 슬롯 후보에서 제외
    const conflictChecks = await Promise.all(
      activeMatched.map(async d => ({
        driver: d,
        conflict: await this.hasScheduleConflict(d.id, booking.preferredDateTime),
      })),
    );
    conflictChecks.forEach(c => {
      if (c.conflict) {
        excluded.push({
          driverId: c.driver.id,
          driverName: c.driver.name,
          reason: `같은 날 다른 배정건과 방문시각이 ${this.MIN_SLOT_GAP_MINUTES}분 이내로 겹침(스케줄 충돌)`,
        });
      }
    });
    const slotFree = conflictChecks.filter(c => !c.conflict).map(c => c.driver);
    if (slotFree.length === 0) return null;

    // 로드밸런싱 기준 배정건수는 "접수(생성)된 날짜"가 아니라 "방문예정일" 기준으로 셈 —
    // 접수일 기준이면 오늘 접수됐지만 방문일이 제각각인 예약들이 뒤섞여서, 실제로 그 방문일에
    // 얼마나 바쁜지가 아니라 "오늘 접수량"으로 분산시키는 꼴이 됨. setHours(0,0,0,0)도 서버
    // 로컬 타임존(UTC) 자정 기준이라 한국 자정과 9시간 어긋나서, KST 자정을 UTC로 환산해 사용.
    const visitDatePart = booking.preferredDateTime?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const kstMidnight = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()));
    const todayStart = new Date(kstMidnight.getTime() - 9 * 60 * 60 * 1000);
    // 진단사가 미배정 건을 앱에서 직접 셀프클레임(assignSource: 'self')한 건은 로드밸런싱
    // 집계에서 제외한다 — 자동배정 몫을 나눠 갖는 게 아니라 본인이 직접 더 잡은 것이므로,
    // 이걸 카운트에 넣으면 적극적으로 잡은 진단사가 오히려 다음 자동배정에서 불리해진다.
    // 자동배정 건을 관리자가 다른 진단사에게 수동으로 넘긴 경우, 원래 받았던 진단사에게
    // 7일간 +1 가상 건수 페널티가 붙어있을 수 있다(assign() 참고) — 실제 건수에 더해서 비교한다.
    const countFor = async (driverId: number) => {
      const rows = visitDatePart
        ? await this.bookingRepository.find({
            where: {
              assignedDriverId: String(driverId),
              status: In(['ASSIGNED', 'CONFIRMED', 'COMPLETED']),
              preferredDateTime: Like(`${visitDatePart}%`),
            },
            select: ['id', 'assignSource'],
          })
        // 방문예정일 파싱 실패 시(형식 이상·미입력) 접수일 기준으로 폴백
        : await this.bookingRepository.find({
            where: { assignedDriverId: String(driverId), createdAt: MoreThanOrEqual(todayStart) },
            select: ['id', 'assignSource'],
          });
      const real = rows.filter(r => r.assignSource !== 'self').length;
      const penalty = await this.assignmentPenaltyRepository.count({
        where: { driverId: String(driverId), type: 'penalty', expiresAt: MoreThanOrEqual(new Date()) },
      });
      // 슈퍼관리자가 수동으로 부여하는 우대 — 로드밸런싱 집계에서 가상 건수를 빼줘서 우선순위를 높인다
      const advantage = await this.assignmentPenaltyRepository.count({
        where: { driverId: String(driverId), type: 'advantage', expiresAt: MoreThanOrEqual(new Date()) },
      });
      return { real, penalty, advantage, total: real + penalty - advantage };
    };

    // 거리 계산 가능하면: 제일 가까운 사람 기준 +15km(왕복 30km, 준오지 기준의 절반) 이내에 있는
    // "가까운 편" 진단사들끼리는 거리보다 해당 방문예정일 배정건수가 적은 사람을 우선 — 한 명한테 쏠리는 것 방지.
    // 그 반경 밖은 굳이 균등 배정 명목으로 멀리 보낼 이유가 없으니 그냥 거리순.
    const NEARBY_RADIUS_KM = 15;
    const coords = geocodedForRegion ?? await geocodeAddress(booking.address);
    const withLocation = slotFree.filter(d => d.lat != null && d.lng != null);
    if (coords && withLocation.length > 0) {
      const ranked = withLocation
        .map(d => ({ driver: d, km: distanceKm(coords.lat, coords.lng, d.lat!, d.lng!) }))
        .sort((a, b) => a.km - b.km);

      const nearestKm = ranked[0].km;
      const nearbyCandidates = ranked.filter(r => r.km <= nearestKm + NEARBY_RADIUS_KM);
      const withCounts = await Promise.all(
        nearbyCandidates.map(async r => ({ ...r, count: await countFor(r.driver.id) })),
      );
      withCounts.sort((a, b) => a.count.total - b.count.total || a.km - b.km);

      const candidateLog = withCounts.map(({ driver, km, count }) => ({
        driverId: driver.id,
        driverName: driver.name,
        km: Math.round(km * 10) / 10,
        todayCount: count.total,
        rawCount: count.real,
        penaltyCount: count.penalty,
        advantageCount: count.advantage,
        maxDailyBookings: driver.maxDailyBookings ?? 5,
        atCap: count.total >= (driver.maxDailyBookings ?? 5),
      }));

      for (const { driver, count } of withCounts) {
        if (count.total < (driver.maxDailyBookings ?? 5)) {
          return {
            driver,
            log: {
              bookingAddress: booking.address,
              bookingCoords: coords,
              nearestKm: Math.round(nearestKm * 10) / 10,
              radiusKm: NEARBY_RADIUS_KM,
              candidates: candidateLog,
              excluded,
              chosenDriverId: driver.id,
              chosenDriverName: driver.name,
              reason: '반경 내 후보 중 방문예정일 배정건수가 가장 적음(동률 시 거리순)',
              assignedAt: new Date().toISOString(),
            },
          };
        }
      }
      // 인근 후보 전원 마감이어도 그중 제일 가까운 사람에게 배정
      return {
        driver: ranked[0].driver,
        log: {
          bookingAddress: booking.address,
          bookingCoords: coords,
          nearestKm: Math.round(nearestKm * 10) / 10,
          radiusKm: NEARBY_RADIUS_KM,
          candidates: candidateLog,
          excluded,
          chosenDriverId: ranked[0].driver.id,
          chosenDriverName: ranked[0].driver.name,
          reason: '반경 내 후보 전원이 해당 방문예정일 최대 배정건수 도달 — 그중 가장 가까운 사람에게 배정',
          assignedAt: new Date().toISOString(),
        },
      };
    }

    // 거리 계산이 안 되면(지오코딩 실패·위치정보 없음) 방문예정일 배정건수가 가장 적은 사람 우선
    const counts = await Promise.all(
      slotFree.map(async d => ({ driver: d, count: await countFor(d.id) })),
    );
    counts.sort((a, b) => a.count.total - b.count.total);
    const picked = counts[0];
    if (!picked) return null;
    return {
      driver: picked.driver,
      log: {
        bookingAddress: booking.address,
        bookingCoords: null,
        candidates: counts.map(({ driver, count }) => ({
          driverId: driver.id,
          driverName: driver.name,
          km: null,
          todayCount: count.total,
          rawCount: count.real,
          penaltyCount: count.penalty,
        })),
        excluded,
        chosenDriverId: picked.driver.id,
        chosenDriverName: picked.driver.name,
        reason: '주소 좌표 변환 실패 또는 위치정보 있는 후보 없음 — 방문예정일 배정건수만으로 비교',
        assignedAt: new Date().toISOString(),
      },
    };
  }

  async findByDriver(driverId: string) {
    const bookings = await this.bookingRepository.find({
      where: { assignedDriverId: driverId },
      order: { createdAt: 'DESC' },
    });
    return this.attachExportBadge(bookings);
  }

  // datrade처럼 "수출전용"으로 표시해둔 발주사(source) 건은 진단사 앱에 "수출건" 뱃지를
  // 붙이고 진단 화면에 수출용 영상 촬영 슬롯을 노출한다 — source의 company를 뽑아서
  // 수출전용 관리자 계정 목록과 대조. findAll()/findByDriver() 양쪽에서 공용으로 씀.
  private async attachExportBadge<T extends { source?: string | null }>(bookings: T[]): Promise<(T & { isExportBooking: boolean })[]> {
    const exportAdmins = await this.userRepository.find({ where: { role: 'admin', isExportOnly: true } });
    const exportCompanies = new Set(exportAdmins.map((a) => a.company).filter(Boolean));

    return bookings.map((b) => {
      const company = b.source?.startsWith('self-') ? b.source.slice(5) : b.source;
      return { ...b, isExportBooking: !!company && exportCompanies.has(company) };
    });
  }

  // 발주사 관리 탭에서 씀 — 실제로 접수가 들어오고 있는 source(발주사 코드) 중에
  // 아직 관리자 계정(User role='admin', company=X)이 없어서 그 발주사가 대시보드에
  // 로그인해도 볼 수 없는 상태인 것들만 골라서 보여준다. KNOWN_B2C_SOURCES(SNS 등
  // 발주사 코드가 아닌 값)는 애초에 대상이 아니라 제외하고, self-{company} 접두사는
  // 원래 회사코드로 합쳐서 집계한다.
  async findUnregisteredSources(): Promise<{ source: string; count: number }[]> {
    const rows = await this.bookingRepository
      .createQueryBuilder('b')
      .select('b.source', 'source')
      .addSelect('COUNT(*)', 'count')
      .groupBy('b.source')
      .getRawMany<{ source: string | null; count: string }>();

    const counted = new Map<string, number>();
    for (const row of rows) {
      if (!row.source || KNOWN_B2C_SOURCES.has(row.source)) continue;
      const company = row.source.startsWith('self-') ? row.source.slice(5) : row.source;
      if (KNOWN_B2C_SOURCES.has(company)) continue;
      counted.set(company, (counted.get(company) ?? 0) + Number(row.count));
    }

    const admins = await this.userRepository.find({ where: { role: 'admin' } });
    const registered = new Set(admins.map((a) => a.company).filter(Boolean));

    return [...counted.entries()]
      .filter(([company]) => !registered.has(company))
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);
  }

  // 파트너패널(발주사 전용 관리페이지) 제안 자격 확인용 — 발주사를 거치지 않고
  // 개별(B2C)로 신청해서 완료까지 간 건수만 센다. 전화번호는 접수자(contact) 또는
  // 실소유주(customerContact) 어느 쪽으로 남았어도 매칭되게 둘 다 확인.
  async countIndividualCompletedByPhone(phone: string): Promise<number> {
    const clean = phone.replace(/[^0-9]/g, '');
    if (!clean) return 0;

    // 파트너패널 QA 테스트 계정 — 실제 개별건수와 무관하게 항상 자격 충족으로 보이게(요청에 의함)
    if (clean === '01022856017') return 10;

    return this.bookingRepository.count({
      where: [
        { contact: clean, status: 'COMPLETED', source: In([...KNOWN_B2C_SOURCES]) },
        { customerContact: clean, status: 'COMPLETED', source: In([...KNOWN_B2C_SOURCES]) },
      ],
    });
  }

  // 진단사 앱이 "예약 요청" 탭을 열어둔 동안 짧은 주기로 부르는 초경량 폴링용 —
  // 대기건 목록의 지문(개수·최대 id·최근 수정시각)만 돌려준다. 앱은 이 값이 직전과
  // 달라졌을 때만 무거운 /list를 다시 부르므로, 새 접수가 뜨는 데 새로고침이 필요 없으면서도
  // 데이터 사용량은 거의 늘지 않는다. 라운딩 요청 건도 같은 탭에 뜨므로 함께 센다.
  async getRequestPulse(): Promise<{ count: number; maxId: number; maxUpdatedAt: string | null }> {
    const raw = await this.bookingRepository
      .createQueryBuilder('b')
      .select('COUNT(b.id)', 'cnt')
      .addSelect('MAX(b.id)', 'maxId')
      .addSelect('MAX(b.updatedAt)', 'maxUpdatedAt')
      .where('b.status = :pending', { pending: 'PENDING' })
      .orWhere('b.roundingRequested = :yes', { yes: true })
      .getRawOne<{ cnt: string; maxId: string | null; maxUpdatedAt: Date | string | null }>();

    return {
      count: Number(raw?.cnt ?? 0),
      maxId: Number(raw?.maxId ?? 0),
      maxUpdatedAt: raw?.maxUpdatedAt ? new Date(raw.maxUpdatedAt).toISOString() : null,
    };
  }

  // includeSelf 없이 source 미지정으로 조회하면(ChavatarApp의 전체 목록 조회가 바로 이 경우)
  // 자체 신청(self-{company}) 건은 기본적으로 제외됨 — 진단사가 방문할 필요 없는 건이
  // 앱 어느 화면에도 노출되지 않게 하기 위함(구버전 앱도 소급 적용됨). source를 명시하면
  // 정확히 일치하는 것만 가져오므로 이 필터와 무관 — "자체 진단 목록" 탭은 source에
  // "self-{company}"를 그대로 넘겨서 조회하니 영향 없음.
  async findAll(source?: string, includeSelf = false, contact?: string): Promise<(Booking & { carHash?: string | null; firstCompletedAt?: Date | null })[]> {
    const bookings = await this.bookingRepository.find({
      where: {
        ...(source ? { source } : {}),
        ...(contact ? { contact } : {}),
      },
      order: { createdAt: 'DESC' },
    });
    const visible = (!source && !includeSelf)
      ? bookings.filter(b => !b.source?.startsWith('self-'))
      : bookings;

    const completedIds = visible.filter(b => b.status === 'COMPLETED').map(b => b.id);
    if (completedIds.length === 0) return this.attachExportBadge(visible);

    const inspections = await this.inspectionRepository.find({
      where: { bookingId: In(completedIds) },
      select: ['bookingId', 'carHash', 'firstCompletedAt'],
    });
    const hashMap = new Map(inspections.map(i => [i.bookingId, i.carHash]));
    const firstCompletedMap = new Map(inspections.map(i => [i.bookingId, i.firstCompletedAt]));

    return this.attachExportBadge(visible.map(b => ({
      ...b,
      carHash: hashMap.get(b.id) ?? null,
      firstCompletedAt: firstCompletedMap.get(b.id) ?? null,
    })));
  }

  async update(id: number, updateData: Partial<Booking> & { cancelReason?: string; cancelledByDriver?: boolean }): Promise<Booking> {
    const booking = await this.bookingRepository.findOneBy({ id });

    if (!booking) {
      throw new NotFoundException(`ID ${id}번에 해당하는 내역을 찾을 수 없습니다.`);
    }

    // ── 진단사가 예약 취소한 경우: 로그 기록 + 사유별 분기 ──
    // 고객 사유("판매자의 예약 취소")는 고객이 서비스 자체를 원하지 않는 것이므로
    // 다른 진단사에게 넘길 필요 없이 그대로 취소 종료. 진단사 사정/노쇼는 다른
    // 진단사가 대신 가야 하므로 기존대로 PENDING 복원해서 재배정 대상이 되게 한다.
    if (updateData.status === 'CANCELLED' && updateData.cancelledByDriver) {
      const prevDriverId = booking.assignedDriverId;
      const prevDriverName = booking.assignedDriverName;
      const cancelReason = updateData.cancelReason || '';

      // 취소 로그 저장
      if (prevDriverId) {
        await this.cancelLogRepository.save({
          driverId: prevDriverId,
          driverName: prevDriverName || '',
          bookingId: booking.id,
          carNumber: booking.carNumber,
          carOwner: booking.carOwner,
          cancelReason,
        });
      }

      const isCustomerReason = cancelReason === '판매자의 예약 취소';
      if (isCustomerReason) {
        // "판매자의 예약 취소"는 진단사 잘못이 아닌 정당한 취소가 많아서(고객 변심 등),
        // 본인 활성시간 안이었다는 이유만으로 매번 바로 페널티를 주지 않는다 — 같은 사유로
        // CANCEL_PENALTY_THRESHOLD회(3회) 누적됐을 때만 페널티를 부과한다(악용 방지 최소선은 유지).
        // 활성시간 밖(=정말 못 갔을 시간)이면 누적 횟수와 무관하게 항상 페널티 없이 재배정.
        const driver = prevDriverId
          ? await this.driverRepository.findOne({ where: { id: Number(prevDriverId) } })
          : null;
        const wasWithinOwnSchedule = driver ? isDriverActiveNow(driver, booking.preferredDateTime) : false;

        if (wasWithinOwnSchedule && prevDriverId) {
          const CANCEL_PENALTY_THRESHOLD = 3;
          const reasonCancelCount = await this.cancelLogRepository.count({
            where: { driverId: prevDriverId, cancelReason },
          });
          if (reasonCancelCount >= CANCEL_PENALTY_THRESHOLD) {
            await this.assignmentPenaltyRepository.save({
              driverId: prevDriverId,
              bookingId: booking.id,
              reason: `${cancelReason} (${reasonCancelCount}회 누적)`,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            });
          }
          // 재배정 없이 취소 종료
          booking.status = 'CANCELLED';
          booking.assignedDriverId = null;
          booking.assignedDriverName = null;
          booking.cancelledByDriverAt = new Date();
          return await this.bookingRepository.save(booking);
        }

        // 본인 활성시간 밖이라 정말 못 가는 경우 — 페널티 없이 재배정 대상(PENDING)으로만 돌리고,
        // 나머지 사유들과 동일하게 관리자가 대시보드에서 수동배정/브로드캐스트로 처리하게 둔다.
        booking.status = 'PENDING';
        booking.assignedDriverId = null;
        booking.assignedDriverName = null;
        booking.cancelledByDriverAt = new Date();
        const savedCustomerCancel = await this.bookingRepository.save(booking);
        await this.refreshDistanceFlags(savedCustomerCancel);
        return savedCustomerCancel;
      }

      // 페널티는 "진단사 사정"(순수 진단사 귀책)만 대상 — 판매자가 현장에 없었던 경우(노쇼)는
      // 진단사 잘못이 아니므로 페널티 없이 재배정 대상으로만 돌린다.
      const isDriverFaultReason = cancelReason === '진단사 사정';
      if (isDriverFaultReason && prevDriverId) {
        await this.assignmentPenaltyRepository.save({
          driverId: prevDriverId,
          bookingId: booking.id,
          reason: cancelReason || null,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
      }

      // PENDING 복원 + 진단사 정보 초기화 (관리자 수동배정/브로드캐스트 대상)
      booking.status = 'PENDING';
      booking.assignedDriverId = null;
      booking.assignedDriverName = null;
      booking.cancelledByDriverAt = new Date();
      const savedCancel = await this.bookingRepository.save(booking);
      await this.refreshDistanceFlags(savedCancel);
      return savedCancel;
    }

    // ── 관리자가 배정 초기화 (unassign) ──
    if (updateData.status === 'PENDING' && 'assignedDriverId' in updateData && !updateData.assignedDriverId) {
      booking.status = 'PENDING';
      booking.assignedDriverId = null;
      booking.assignedDriverName = null;
      booking.cancelledByDriverAt = null;
      const savedUnassign = await this.bookingRepository.save(booking);
      await this.refreshDistanceFlags(savedUnassign);
      return savedUnassign;
    }

    // ── 진단사 앱 "예약 요청" 탭 "내 담당으로 확정하기"(셀프클레임) ──
    // handleClaim()이 보내는 시그니처(PENDING → status:CONFIRMED + assignedDriverId)만 여기 해당.
    // 반드시 원자적 UPDATE로 처리해야 함 — 예전엔 위 823행에서 findOneBy로 읽은 뒤 메모리에서
    // 상태를 바꿔 save()하는 read-then-write였는데, 두 진단사가 거의 동시에 눌렀을 때 두 요청
    // 모두 "아직 미배정"으로 읽어버리고 나중에 커밋되는 쪽이 이기는(last-write-wins) 레이스
    // 컨디션이 있었다(실제 발생: 먼저 누른 진단사 배정이 나중에 누른 진단사로 뒤바뀜). 선착순이
    // 진단사 책임(현장 방문 의무) 소재를 가르는 구조라 이 순서는 정확해야 한다 — WHERE절에
    // "아직 미배정" 조건을 걸어서 DB 행 잠금으로 동시성을 보장한다(둘 중 먼저 커밋된 UPDATE만
    // affected=1, 나머지는 0으로 자동 실패).
    if (updateData.status === 'CONFIRMED' && updateData.assignedDriverId) {
      const claimResult = await this.bookingRepository
        .createQueryBuilder()
        .update(Booking)
        .set({
          status: 'ASSIGNED',
          assignedDriverId: updateData.assignedDriverId,
          assignedDriverName: updateData.assignedDriverName,
          assignSource: 'self',
          assignedAt: new Date(),
          cancelledByDriverAt: null,
        })
        .where('id = :id', { id })
        .andWhere('status = :pending', { pending: 'PENDING' })
        .andWhere('assignedDriverId IS NULL')
        .execute();

      if (claimResult.affected === 0) {
        // 진 쪽에게는 "누가 먼저 가져갔는지"까지 알려줘야 앱에서 그냥 실패로 보이지 않고
        // 책임 소재(선착순)가 납득이 된다 — 실패 원인을 다시 읽어서 문구를 만든다.
        const current = await this.bookingRepository.findOneBy({ id });
        if (!current) throw new NotFoundException(`ID ${id}번에 해당하는 내역을 찾을 수 없습니다.`);
        if (String(current.assignedDriverId) === String(updateData.assignedDriverId)) {
          // 같은 진단사가 두 번 눌렀거나(더블탭) 응답이 늦어 재시도한 경우 — 실패가 아니다
          return current;
        }
        const owner = current.assignedDriverName || '다른 진단사';
        console.warn(
          `⚔️ [셀프클레임 경합] #${id} ${current.carNumber} — 요청자 ${updateData.assignedDriverName}(${updateData.assignedDriverId}) 실패, 선점자 ${owner}(${current.assignedDriverId}) status=${current.status}`,
        );
        throw new ConflictException(
          current.assignedDriverId
            ? `이미 ${owner} 평가사님이 먼저 확정한 건입니다.`
            : '지금은 확정할 수 없는 상태의 예약입니다. 목록을 새로고침해주세요.',
        );
      }

      const claimed = await this.bookingRepository.findOneBy({ id });
      if (!claimed) throw new NotFoundException(`ID ${id}번에 해당하는 내역을 찾을 수 없습니다.`);
      await this.refreshDistanceFlags(claimed);
      try {
        const driver = await this.driverRepository.findOne({ where: { id: Number(updateData.assignedDriverId) } });
        if (driver?.pushToken) {
          await this.notificationsService.sendPush(
            driver.pushToken,
            '(수동배정) 진단건이 확정되었습니다.',
            `${claimed.carOwner}님 · ${claimed.carNumber} · ${claimed.preferredDateTime}`,
            { bookingId: claimed.id },
          );
        }
      } catch (e) {}
      return claimed;
    }

    // 매입가는 계약금+잔금 합계로 자동 계산 — 둘 중 하나라도 들어오면 매입가를 다시 계산한다
    if ('contractDeposit' in updateData || 'contractBalance' in updateData) {
      const deposit = 'contractDeposit' in updateData ? updateData.contractDeposit : booking.contractDeposit;
      const balance = 'contractBalance' in updateData ? updateData.contractBalance : booking.contractBalance;
      updateData.purchasePrice = (deposit || 0) + (balance || 0);
    }

    // 매입가/구전은 값이 바뀌어 새로 적힌 건 목록에서 빨간색(안 봄)으로 강조했다가, 관리자가
    // 목록에서 숫자를 한 번 클릭하면(별도 PATCH로 xxxSeen만 true) 파란색(확인함)으로 바뀐다 —
    // 여기서는 값이 실제로 달라질 때만 "새로 적힘" 상태로 되돌린다(같은 값 재저장은 무시).
    if ('purchasePrice' in updateData && updateData.purchasePrice !== booking.purchasePrice) {
      booking.purchasePriceSeen = false;
    }
    if ('contractDeposit' in updateData && updateData.contractDeposit !== booking.contractDeposit) {
      booking.contractDepositSeen = false;
    }
    if ('oldDealerFee' in updateData && updateData.oldDealerFee !== booking.oldDealerFee) {
      booking.oldDealerFeeSeen = false;
    }

    // 담당 진단사에게 "예약 정보가 바뀌었어요" 알림을 보내기 위해, 덮어쓰기 전 값을 남겨둔다.
    const prevCustomerContact = booking.customerContact;
    const prevAdminMemo = booking.adminMemo;

    Object.assign(booking, updateData);
    const updated = await this.bookingRepository.save(booking);

    // 이미 배정된 건을 관리자가 나중에 수정한 경우, 담당 진단사에게 "확인해주세요" 알림.
    // 대상: (1) 없던 고객번호가 새로 채워짐, (2) 관리자메모가 바뀜. 셀프클레임 등 배정 자체를
    // 바꾸는 액션과는 무관하게, 이미 배정돼 있던 건이 그대로 유지된 채 내용만 바뀐 경우만 해당.
    if (updated.assignedDriverId) {
      const changedLabels: string[] = [];
      if (!prevCustomerContact && updated.customerContact) changedLabels.push('고객 연락처');
      if (prevAdminMemo !== updated.adminMemo) changedLabels.push('관리자 메시지');

      if (changedLabels.length > 0) {
        try {
          const driver = await this.driverRepository.findOne({ where: { id: Number(updated.assignedDriverId) } });
          if (driver?.pushToken) {
            await this.notificationsService.sendPush(
              driver.pushToken,
              '예약이 수정되었어요 📋',
              `${updated.carNumber} · ${changedLabels.join(', ')} 확인 부탁드려요`,
              { bookingId: updated.id },
              PUSH_CHANNEL_BOOKING_UPDATED,
            );
          }
        } catch (e) {}
      }
    }

    return updated;
  }

  // source: 'auto'는 create()의 자동배정 성공 시에만 내부적으로 넘김 — 그 외(대시보드/지도에서
  // 관리자가 직접 배정)는 전부 기본값 'manual'로 처리되어 진단사에게 다른 문구로 알림이 감.
  async assign(id: number, driverInfo: { id: string; name: string }, source: 'auto' | 'manual' | 'agent' = 'manual', assignedByAgentId?: string) {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) throw new NotFoundException('해당 신청 내역을 찾을 수 없습니다.');

    // 자동배정으로 받은 건을 관리자가 다른 진단사에게 수동으로 넘긴 경우, 원래 받았던
    // 진단사에게 7일간 자동배정 로드밸런싱 +1 페널티 — 에이전트가 직접 확보한 물건(자동배정이
    // 아니었던 건)을 넘기는 경우는 해당 없음(공지 참고).
    if (
      source === 'manual' &&
      booking.assignSource === 'auto' &&
      booking.assignedDriverId &&
      String(booking.assignedDriverId) !== String(driverInfo.id)
    ) {
      await this.assignmentPenaltyRepository.save({
        driverId: String(booking.assignedDriverId),
        bookingId: booking.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
    }

    booking.assignedDriverId = driverInfo.id;
    booking.assignedDriverName = driverInfo.name;
    booking.status = 'ASSIGNED';
    booking.cancelledByDriverAt = null; // 재배정 시 재대기 플래그 초기화
    booking.driverSeenAt = null; // 재배정되면 새 담당자 기준으로 "확인 여부"를 다시 센다
    booking.assignedByAgentId = source === 'agent' ? (assignedByAgentId ?? null) : null;
    booking.assignedAt = new Date();
    booking.assignSource = source;

    const saved = await this.bookingRepository.save(booking);
    // 재배정 시점 기준 최신 진단사 위치로 오지/준오지 뱃지 갱신
    await this.refreshDistanceFlags(saved);

    try {
      const driver = await this.driverRepository.findOne({ where: { id: Number(driverInfo.id) } });
      if (driver?.pushToken) {
        await this.notificationsService.sendPush(
          driver.pushToken,
          source === 'auto' ? '(자동배정) 신규 신청이 접수되었습니다.' : source === 'agent' ? '(에이전트 배정) 진단건이 배정되었습니다.' : '(수동배정) 진단건이 확정되었습니다.',
          `${saved.carOwner}님 · ${saved.carNumber} · ${saved.preferredDateTime}`,
          { bookingId: saved.id },
        );
      }

    } catch (e) {}

    // 자동배정 건만 평가사 본인에게 카카오톡으로 한 번 더 알림 — 앱 푸시는 평가사가
    // 못 볼 수 있어서, 사람이 직접 배정한 건(manual/agent)은 이미 배정 사실을 알고 있으니 제외.
    if (source === 'auto') {
      try {
        const driver = await this.driverRepository.findOne({ where: { id: Number(driverInfo.id) } });
        if (driver?.phone) {
          const todayCount = await this.countBookingsOnSameDay(driverInfo.id, saved.preferredDateTime);
          await this.solapiService.sendDriverAssignmentAlimTalk(driver.phone, {
            '#{평가사명}': driverInfo.name,
            '#{상대명}': saved.dealerName || saved.carOwner || '고객',
            '#{연락처}': saved.dealerContact || saved.customerContact || saved.contact || '-',
            '#{진단일시}': saved.preferredDateTime || '미입력',
            '#{총진단건수}': String(todayCount),
          });
          console.log(`✅ [배정알림톡] 평가사(${driver.phone})에게 자동배정 안내 전송 (${saved.carNumber})`);
        }
      } catch (error: unknown) {
        console.error('❌ [배정알림톡(평가사) 발송 실패]', (error as Error).message);
      }
    }

    // 대시보드에서 배정할 때 실제로 타는 경로는 이 assign()이다 — 고객에게 배정완료
    // 알림톡이 안 갔던 원인은 이 메서드에 발송 로직 자체가 없었기 때문(진단사 앱 푸시만 있었음).
    // 딜러번호(contact)/고객번호(customerContact) 둘 다 선택사항이라, 있는 쪽을 우선 사용(고객번호 우선)하고
    // 둘 다 없으면 알림톡 자체를 건너뜀(빈 번호로 SOLAPI 호출하면 에러만 남고 의미 없음).
    const notifyTarget = saved.customerContact || saved.contact;
    if (notifyTarget) {
      try {
        const kakaoVariables = {
          '#{진단사명}': driverInfo.name,
          '#{진단사연락처}': '070-4138-2017',
          '#{차량번호}': saved.carNumber,
        };
        await this.solapiService.sendAlimTalk(notifyTarget, kakaoVariables);
        console.log(`✅ [알림톡 발송] 고객(${notifyTarget})께 배정 완료 알림 전송 (담당: ${driverInfo.name})`);
      } catch (error: unknown) {
        console.error('❌ [배정완료 알림톡 발송 실패]', (error as Error).message);
      }
    } else {
      console.log(`🔕 [배정완료 알림톡 생략] ${saved.carNumber} — 딜러/고객 연락처 둘 다 없음`);
    }

    return saved;
  }

  // 고객 셀프서비스 취소 — 전화번호로 본인 확인만 하고, 결제 취소 자체는 자동화하지 않는다
  // (토스 paymentKey를 저장하지 않아 API로 즉시 환불 불가 + 계좌이체는 어차피 수동 처리라
  // 상태만 CANCELLED로 바꾸고 환불 예정 금액을 계산해서 관리자에게 SMS로 알린다).
  private readonly SELF_CANCEL_FEE = 30_000;

  private normalizePhone(v?: string | null): string {
    return (v || '').replace(/[^0-9]/g, '');
  }

  // preferredDateTime은 소스마다 "YYYY-MM-DD HH:mm" 또는 "YYYY-MM-DDTHH:mm" 형태라 통일
  private parsePreferredDateTime(raw?: string | null): Date | null {
    if (!raw) return null;
    const d = new Date(raw.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // 환불 규정(app/policy/refund) 그대로: 결제 후 1시간 이내는 무조건 전액,
  // 그 외엔 방문일 전날 18시 이전=전액 / 방문 시간 전=수수료 3만원 차감 / 방문 시간 이후=환불 없음
  private computeRefund(booking: Booking): { tier: 'FULL' | 'FEE' | 'NONE'; refundAmount: number; cancelFee: number } {
    const amount = booking.amount ?? 0;
    const now = new Date();

    if (now.getTime() - booking.createdAt.getTime() < 60 * 60 * 1000) {
      return { tier: 'FULL', refundAmount: amount, cancelFee: 0 };
    }

    const visitTime = this.parsePreferredDateTime(booking.preferredDateTime);
    if (!visitTime) {
      return { tier: 'FEE', refundAmount: Math.max(amount - this.SELF_CANCEL_FEE, 0), cancelFee: this.SELF_CANCEL_FEE };
    }

    const dayBefore18 = new Date(visitTime);
    dayBefore18.setDate(dayBefore18.getDate() - 1);
    dayBefore18.setHours(18, 0, 0, 0);

    if (now <= dayBefore18) {
      return { tier: 'FULL', refundAmount: amount, cancelFee: 0 };
    }
    if (now < visitTime) {
      return { tier: 'FEE', refundAmount: Math.max(amount - this.SELF_CANCEL_FEE, 0), cancelFee: this.SELF_CANCEL_FEE };
    }
    return { tier: 'NONE', refundAmount: 0, cancelFee: amount };
  }

  // 연락처 또는 이름 중 하나만 맞아도 본인 확인 통과 (신청 당시 정보를 둘 다 정확히
  // 기억 못 하는 고객이 많아 OR 조건으로 완화함 — 예약번호(id)를 알고 있다는 전제가 있어
  // 이름만으로 확인해도 리스크가 낮음)
  private async findBookingForCustomer(id: number, contact?: string, name?: string): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    const inputDigits = this.normalizePhone(contact);
    const nameTrimmed = (name || '').trim();
    const matches =
      !!booking &&
      ((inputDigits.length > 0 &&
        (this.normalizePhone(booking.contact) === inputDigits || this.normalizePhone(booking.customerContact) === inputDigits)) ||
        (nameTrimmed.length > 0 && booking.carOwner?.trim() === nameTrimmed));
    if (!matches) {
      throw new NotFoundException('예약 정보를 찾을 수 없습니다. 예약번호와 이름 또는 연락처를 다시 확인해주세요.');
    }
    return booking!;
  }

  // 진단 완료 건은 검차사진이 이미 있으므로 마이페이지 카드 썸네일로 첫 사진을 그대로 씀
  // (카비어 로고 플레이스홀더 대신) — carHash도 같이 내려줘서 프론트가 /auction/market
  // 스타일 상세뷰로 연결할 수 있게 함.
  private async toCustomerView(booking: Booking) {
    const inspection = booking.status === 'COMPLETED'
      ? await this.inspectionRepository.findOne({ where: { bookingId: booking.id } })
      : null;
    const p = inspection?.photos;
    const thumbnailUrl = p
      ? (p.exterior?.[0] ?? p.interior?.[0] ?? p.extra?.[0] ?? p.engine?.[0] ?? p.wheel?.[0] ?? p.undercarriage?.[0] ?? p.damage?.[0])
      : undefined;
    return {
      id: booking.id,
      carNumber: booking.carNumber,
      carModel: booking.carModel,
      address: booking.address,
      preferredDateTime: booking.preferredDateTime,
      status: booking.status,
      amount: booking.amount,
      paymentMethod: booking.paymentMethod,
      depositConfirmed: booking.depositConfirmed,
      buyerPurchaseCompleted: booking.buyerPurchaseCompleted,
      buyerHidden: booking.buyerHidden,
      createdAt: booking.createdAt,
      refundPreview: this.computeRefund(booking),
      thumbnailUrl,
      carHash: inspection?.carHash,
    };
  }

  // GET: 예약번호 + (연락처 또는 이름)로 본인 예약 조회 (셀프 취소 전 확인 화면용, 인증 없이 공개된 조회 API)
  async lookupForCustomer(id: number, contact?: string, name?: string) {
    const booking = await this.findBookingForCustomer(id, contact, name);
    return this.toCustomerView(booking);
  }

  // GET: 예약번호를 몰라도 신청자 이름 또는 연락처만으로 본인 예약을 찾을 수 있게 하는 조회 API —
  // 원래는 이름+연락처 둘 다 정확히 일치해야 했는데, 신청 당시 정보를 정확히 기억 못 하는
  // 고객이 많아 "이름 OR 연락처" 중 하나만 맞아도 찾아지도록 완화함.
  // 같은 이름/번호로 여러 건을 신청했을 수 있어 배열로 반환한다.
  async lookupByNameAndContact(name?: string, contact?: string) {
    const nameTrimmed = (name || '').trim();
    const inputDigits = this.normalizePhone(contact);
    if (!nameTrimmed && inputDigits.length === 0) {
      throw new BadRequestException('이름 또는 연락처 중 하나는 입력해주세요.');
    }

    // DB에서는 넓게 후보를 추리고(이름 일치 OR 연락처 부분일치), 실제 최종 판정은 아래
    // normalizePhone 비교로 정확히 함 — 연락처가 하이픈 없이 저장되는 게 기본이라 LIKE로 충분.
    const qb = this.bookingRepository
      .createQueryBuilder('b')
      .orderBy('b.createdAt', 'DESC')
      .take(50);
    if (nameTrimmed) qb.orWhere('b.carOwner = :name', { name: nameTrimmed });
    if (inputDigits) {
      qb.orWhere('b.contact LIKE :digits', { digits: `%${inputDigits}%` });
      qb.orWhere('b.customerContact LIKE :digits', { digits: `%${inputDigits}%` });
    }
    const candidates = await qb.getMany();

    const matched = candidates.filter(
      (b) =>
        (nameTrimmed.length > 0 && b.carOwner?.trim() === nameTrimmed) ||
        (inputDigits.length > 0 &&
          (this.normalizePhone(b.contact) === inputDigits || this.normalizePhone(b.customerContact) === inputDigits)),
    );
    if (matched.length === 0) {
      throw new NotFoundException('일치하는 예약을 찾을 수 없습니다. 이름 또는 연락처를 다시 확인해주세요.');
    }
    // 완전히 구매해서 본인 상사에서 따로 팔 예정이라 마이페이지에서 숨긴 건은 목록에서 제외.
    // 진단완료됐는데 2주 넘도록 "구매완료"도 "숨기기"도 안 눌린 건은 대부분 구매를 포기한
    // 케이스라, 계속 더미로 쌓이지 않도록 목록에서 자동 제외(레코드 자체는 삭제 안 함).
    // 취소된 건은 날짜만 바꿔서 재신청하면 되는 경우가 대부분이라 1주일이면 충분히 짧게 제외.
    const STALE_MS = 14 * 24 * 60 * 60 * 1000;
    const CANCELLED_STALE_MS = 7 * 24 * 60 * 60 * 1000;
    const visible = matched.filter((b) => {
      if (b.buyerHidden) return false;
      if (b.status === 'COMPLETED' && !b.buyerPurchaseCompleted) {
        return Date.now() - new Date(b.createdAt).getTime() <= STALE_MS;
      }
      if (b.status === 'CANCELLED') {
        return Date.now() - new Date(b.updatedAt).getTime() <= CANCELLED_STALE_MS;
      }
      return true;
    });
    return Promise.all(visible.map((b) => this.toCustomerView(b)));
  }

  // PATCH: 고객 셀프 취소 — 상태만 CANCELLED로 바꾸고 실제 환불은 관리자가 수동 처리
  async selfCancel(id: number, contact?: string, name?: string) {
    const booking = await this.findBookingForCustomer(id, contact, name);

    if (booking.status === 'COMPLETED') {
      throw new BadRequestException('이미 진단이 완료된 건은 취소할 수 없습니다.');
    }
    if (booking.status === 'CANCELLED') {
      throw new BadRequestException('이미 취소된 예약입니다.');
    }

    const refund = this.computeRefund(booking);
    booking.status = 'CANCELLED';
    booking.cancelledBySelf = true;
    booking.refundAmount = refund.refundAmount;
    const saved = await this.bookingRepository.save(booking);

    try {
      const tierLabel = refund.tier === 'FULL' ? '전액환불' : refund.tier === 'FEE' ? `수수료${refund.cancelFee.toLocaleString()}원차감` : '환불없음';
      await this.solapiService.sendSms(
        '01022856017',
        `[카비어] 고객셀프취소 ${booking.carNumber} ${booking.preferredDateTime} ${tierLabel} 환불${refund.refundAmount.toLocaleString()}원 결제:${booking.paymentMethod || '-'}`,
      );
    } catch {}

    return { success: true, data: saved, refund };
  }

  // PATCH: 고객 셀프서비스 — 취소된 예약을 결제 후 1시간 이내(=환불정책상 전액환불 구간)라면
  // 새로 신청/재결제 없이 날짜만 바꿔서 그대로 되살린다. 이 창구를 넘기면 이미 관리자가
  // 수동 환불을 처리했을 가능성이 있어 막고 새로 신청하도록 안내한다.
  async reschedule(id: number, contact: string | undefined, name: string | undefined, preferredDateTime: string) {
    const booking = await this.findBookingForCustomer(id, contact, name);

    if (booking.status !== 'CANCELLED') {
      throw new BadRequestException('취소된 예약만 날짜를 바꿔 재신청할 수 있습니다.');
    }
    if (Date.now() - booking.createdAt.getTime() >= 60 * 60 * 1000) {
      throw new BadRequestException('신청 후 1시간이 지나 날짜 변경이 불가합니다. 새로 신청해주세요.');
    }
    const newVisitTime = this.parsePreferredDateTime(preferredDateTime);
    if (!newVisitTime) {
      throw new BadRequestException('올바른 희망일시를 선택해주세요.');
    }

    const prevDateTime = booking.preferredDateTime;
    booking.status = 'PENDING';
    booking.cancelledBySelf = false;
    booking.refundAmount = null;
    booking.preferredDateTime = preferredDateTime;
    const saved = await this.bookingRepository.save(booking);

    try {
      await this.solapiService.sendSms(
        '01022856017',
        `[카비어] 고객 날짜변경 재신청 ${booking.carNumber} ${prevDateTime} → ${preferredDateTime}`,
      );
    } catch {}

    return { success: true, data: await this.toCustomerView(saved) };
  }

  // 마이페이지에서 신청자(대부분 구매예정자) 본인이 "구매완료" 셀프 표시 — 검증 수단이
  // 없는 자기신고 값이라 상태를 강제로 바꾸는 용도로 쓰면 안 됨(표시용).
  async updateBuyerPurchaseStatus(id: number, contact: string | undefined, completed: boolean, name?: string): Promise<Booking> {
    const booking = await this.findBookingForCustomer(id, contact, name);
    booking.buyerPurchaseCompleted = completed;
    return this.bookingRepository.save(booking);
  }

  // 완전히 구매해서 본인 상사(딜러)에서 따로 팔 예정 — 카비어에 낼 의사가 없어서
  // 마이페이지 목록에서 아예 숨김(단방향, 되돌리는 UI는 아직 없음).
  async updateBuyerHidden(id: number, contact: string | undefined, hidden: boolean, name?: string): Promise<Booking> {
    const booking = await this.findBookingForCustomer(id, contact, name);
    booking.buyerHidden = hidden;
    return this.bookingRepository.save(booking);
  }

  // 발주사(대시보드)가 명의이전 완료 후 등록증 사진을 직접 업로드
  // 이전된 등록증 사진을 업로드하고, 선택한 대상(딜러/고객)에게 각각 확인 링크 SMS를 보낸다
  // (대상별 건당 1회 제한, 각 발송 50원씩 회사별 과금 장부에 기록 — 실제 결제/차감은 아니고 수동 청구 참고용).
  async saveTransferredRegistration(
    id: number,
    url: string | undefined,
    message: string | undefined,
    options: { sendToDealer: boolean; sendToCustomer: boolean; dealerPhone?: string; customerPhone?: string },
  ) {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) throw new NotFoundException('해당 신청 내역을 찾을 수 없습니다.');
    if (!url && !booking.transferredRegistrationUrl) {
      throw new BadRequestException('사진을 첨부해주세요.');
    }

    const targets: { target: 'dealer' | 'customer'; phone?: string | null }[] = [];
    if (options.sendToDealer) {
      if (booking.registrationSentToDealerAt) {
        throw new BadRequestException('이미 딜러에게 등록증을 전송했습니다.');
      }
      targets.push({ target: 'dealer', phone: options.dealerPhone?.trim() || booking.contact });
    }
    if (options.sendToCustomer) {
      if (booking.registrationSentToCustomerAt) {
        throw new BadRequestException('이미 고객에게 등록증을 전송했습니다.');
      }
      targets.push({ target: 'customer', phone: options.customerPhone?.trim() || booking.customerContact });
    }
    // 사진을 새로 첨부한 경우에만 교체 — 잘못된 등록증을 올린 경우 여기서 다시 올리면 이미 보낸
    // 단축링크(/v1/r/:id)가 그대로 새 사진으로 리다이렉트되어 재전송 없이 바로잡힌다. 첨부가
    // 없으면(예: 딜러만 보내고 나중에 고객만 추가로 보내는 경우) 기존 사진 그대로 사용한다.
    if (url) booking.transferredRegistrationUrl = url;

    if (targets.length === 0) {
      // 딜러/고객 둘 다 선택하지 않은 경우 = SMS 없이 사진만 교체
      return this.bookingRepository.save(booking);
    }

    // S3 원본 URL은 90byte 제한을 훌쩍 넘겨서 SMS 접수 자체가 거부됨 — 짧은 리다이렉트 링크로 대체
    const shortLink = `https://carvior.store/api/v1/r/${booking.id}`;
    let detail = message?.trim() || '이전된 차량등록증을 보내드립니다.';
    let text = `[카비어] ${detail}\n${shortLink}`;
    while (Buffer.byteLength(text, 'utf-8') > 88 && detail.length > 1) {
      detail = detail.slice(0, -1);
      text = `[카비어] ${detail}…\n${shortLink}`;
    }

    // 실패를 조용히 삼키면 실제로는 문자가 안 갔는데도 "보냈습니다"로 표시되고, 체크박스도
    // 다시 열어보면 계속 살아있게 됨(전송 성공 여부로 잠그기 때문) — 그래서 대상별 실패를
    // 모아서 응답에 담아 관리자가 무엇이 실패했는지 알 수 있게 한다.
    const failures: string[] = [];
    for (const { target, phone } of targets) {
      const label = target === 'dealer' ? '딜러' : '고객';
      if (!phone) {
        failures.push(`${label}: 연락처가 없습니다.`);
        continue;
      }
      try {
        await this.solapiService.sendSms(phone, text);
        await this.smsBillingLogRepository.save({
          source: booking.source,
          bookingId: booking.id,
          carNumber: booking.carNumber,
          recipientContact: phone,
          recipient: target,
          purpose: 'registration-send',
        });
        if (target === 'dealer') booking.registrationSentToDealerAt = new Date();
        if (target === 'customer') booking.registrationSentToCustomerAt = new Date();
      } catch (e) {
        console.error(`[등록증 전송 실패] booking ${booking.id} → ${target}`, e);
        failures.push(`${label}: 문자 발송에 실패했습니다.`);
      }
    }

    const saved = await this.bookingRepository.save(booking);
    return { ...saved, sendFailures: failures };
  }

  // SMS 90byte 제한 안에 넣으려고 S3 원본 URL 대신 이 짧은 리다이렉트 링크(/v1/r/:id)를 보낸다
  async getTransferredRegistrationUrl(id: number): Promise<string> {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking?.transferredRegistrationUrl) throw new NotFoundException('등록증을 찾을 수 없습니다.');
    return booking.transferredRegistrationUrl;
  }

  // 관리자가 "긴급·당일배정"으로 수동 브로드캐스트 — 자동배정/평소 브로드캐스트는 스케줄(가용시간)과
  // 활동중 여부를 보고 대상을 거르는데, 이 경로는 그걸 전부 무시하고 승인된 진단사 전원에게 발송한다.
  // (예: 오늘 방문 건인데 등록된 스케줄상 아무도 안 맞거나 전원 활동중지 상태라 자동배정이 실패한 경우 —
  // 실제로는 그 시간에 여유 있는 진단사가 있을 수 있으니 최후 수단으로 강제 브로드캐스트)
  async broadcastUrgent(id: number) {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) throw new NotFoundException('해당 신청 내역을 찾을 수 없습니다.');

    booking.isUrgent = true;
    const saved = await this.bookingRepository.save(booking);

    try {
      const drivers = await this.driverRepository.find({ where: { status: 'APPROVED' } });
      const pushTargets = drivers.filter(d => d.pushToken);
      await Promise.all(
        pushTargets.map(d =>
          this.notificationsService.sendPush(
            d.pushToken,
            '🚨 긴급·당일배정 요청',
            `${saved.address} · ${saved.preferredDateTime} — 지금 가능하시면 예약 요청 탭에서 확인해주세요.`,
            { bookingId: saved.id },
          ),
        ),
      );
      console.log(`🚨 [긴급브로드캐스트] ${saved.carNumber} → 진단사 ${pushTargets.length}명에게 발송`);
    } catch (e) {
      console.error('❌ [긴급브로드캐스트 발송 실패]', (e as Error).message);
    }

    return saved;
  }

  // 에이전트 진단평가사가 예약대기 건을 다른 진단사에게 지정 배정
  async agentAssign(id: number, agentDriverId: string, targetDriverId: string, targetDriverName: string) {
    const agent = await this.driverRepository.findOne({ where: { id: Number(agentDriverId) } });
    if (!agent || agent.tier !== 'agent') {
      throw new BadRequestException('에이전트 진단평가사만 지정 배정할 수 있습니다.');
    }
    return this.assign(id, { id: targetDriverId, name: targetDriverName }, 'agent', agentDriverId);
  }

  // 일반 평가사가 담당 건을 진단/에이전트 등급에게 "라운딩" 요청
  async requestRounding(id: number, driverId: string) {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) throw new NotFoundException('해당 신청 내역을 찾을 수 없습니다.');
    if (String(booking.assignedDriverId) !== String(driverId)) {
      throw new BadRequestException('본인이 담당한 건만 라운딩 요청할 수 있습니다.');
    }
    booking.roundingRequested = true;
    booking.roundingRequestedAt = new Date();
    const saved = await this.bookingRepository.save(booking);

    try {
      const targets = await this.driverRepository.find({
        where: [
          { status: 'APPROVED', isActive: true, tier: 'certified' },
          { status: 'APPROVED', isActive: true, tier: 'agent' },
        ],
      });
      const pushTargets = targets.filter(d => d.pushToken && String(d.id) !== String(driverId));
      await Promise.all(
        pushTargets.map(d =>
          this.notificationsService.sendPush(
            d.pushToken,
            '라운딩 요청이 있습니다 🙋',
            `${saved.address} · ${saved.preferredDateTime}`,
            { bookingId: saved.id },
          ),
        ),
      );
    } catch (e) {}

    return saved;
  }

  // 진단/에이전트 등급 진단사가 라운딩 요청을 수락 — 담당자가 그 사람으로 바뀜
  async acceptRounding(id: number, driverInfo: { id: string; name: string }) {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) throw new NotFoundException('해당 신청 내역을 찾을 수 없습니다.');
    if (!booking.roundingRequested) {
      throw new BadRequestException('이미 처리되었거나 요청되지 않은 건입니다.');
    }
    const previousDriverId = booking.assignedDriverId;

    booking.assignedDriverId = driverInfo.id;
    booking.assignedDriverName = driverInfo.name;
    booking.roundingRequested = false;
    booking.roundingRequestedAt = null;
    const saved = await this.bookingRepository.save(booking);

    try {
      if (previousDriverId) {
        const prevDriver = await this.driverRepository.findOne({ where: { id: Number(previousDriverId) } });
        if (prevDriver?.pushToken) {
          await this.notificationsService.sendPush(
            prevDriver.pushToken,
            '라운딩이 수락되었습니다',
            `${driverInfo.name} 평가사가 ${saved.carNumber} 건을 인계받았습니다.`,
            { bookingId: saved.id },
          );
        }
      }
    } catch (e) {}

    return saved;
  }

  // 진단사 취소 통계
  async getDriverCancelStats(driverId: string) {
    const logs = await this.cancelLogRepository.find({
      where: { driverId },
      order: { createdAt: 'DESC' },
    });

    const totalAssigned = await this.bookingRepository.count({
      where: { assignedDriverId: driverId },
    });

    const reasonCounts: Record<string, number> = {};
    for (const log of logs) {
      const r = log.cancelReason || '기타';
      reasonCounts[r] = (reasonCounts[r] || 0) + 1;
    }

    return {
      totalAssigned,
      totalCancelled: logs.length,
      cancelRate: totalAssigned > 0 ? Math.round((logs.length / totalAssigned) * 100) : 0,
      reasonCounts,
      recentLogs: logs.slice(0, 10),
    };
  }

  // CS 관리 페이지용 진단사 취소 로그 전체 목록 — COMPANY_ADMIN은 자사 의뢰(source) 건만 봐야 하므로
  // bookingId로 조인해서 해당 발주사 소속 로그만 필터링
  async findCancelLogs(source?: string) {
    if (!source) {
      return await this.cancelLogRepository.find({ order: { createdAt: 'DESC' } });
    }
    const bookings = await this.bookingRepository.find({ where: { source }, select: ['id'] });
    const bookingIds = bookings.map(b => b.id);
    if (bookingIds.length === 0) return [];
    return await this.cancelLogRepository.find({
      where: { bookingId: In(bookingIds) },
      order: { createdAt: 'DESC' },
    });
  }

  // 슈퍼관리자 페널티/우대 관리 — 활성(만료 안 된) 건만 진단사 이름과 함께 반환
  async listDriverPenalties() {
    const rows = await this.assignmentPenaltyRepository.find({
      where: { expiresAt: MoreThanOrEqual(new Date()) },
      order: { createdAt: 'DESC' },
    });
    const driverIds = [...new Set(rows.map(r => r.driverId))];
    const drivers = driverIds.length
      ? await this.driverRepository.find({ where: { id: In(driverIds.map(Number)) } })
      : [];
    const nameMap = new Map(drivers.map(d => [String(d.id), d.name]));
    return rows.map(r => ({
      ...r,
      driverName: nameMap.get(r.driverId) ?? '알수없음',
    }));
  }

  // 슈퍼관리자가 진단사에게 수동으로 페널티(로드밸런싱 +1) 또는 우대(-1)를 부여
  async createDriverPenalty(data: { driverId: string; type: 'penalty' | 'advantage'; days?: number; reason?: string }) {
    const days = data.days && data.days > 0 ? data.days : 7;
    return await this.assignmentPenaltyRepository.save({
      driverId: data.driverId,
      type: data.type,
      reason: data.reason || null,
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    });
  }

  // 페널티/우대 건 삭제(즉시 만료 처리와 동일한 효과)
  async deleteDriverPenalty(id: number) {
    await this.assignmentPenaltyRepository.delete(id);
    return { success: true };
  }
}
