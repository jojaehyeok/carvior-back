/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { SolapiService } from '../solapi/solapi.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Driver } from '../drivers/entities/driver.entity';
import { DriverCancelLog } from '../driver-cancel-logs/driver-cancel-log.entity';
import { Inspection } from '../inspection/entities/inspection.entity';
import { User } from '../users/entities/user.entity';
import { distanceKm, geocodeAddress, isDriverActiveNow, isLocationFresh } from './auto-assign.util';

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
]);

// 자동배정은 "지금 이 순간 활성 상태인 진단사"만 보고 판단하는 즉시배정 로직이라,
// 방문일이 접수 시점보다 한참 뒤인 예약건에 적용하면 실제 방문일의 스케줄과 무관하게
// 배정되거나 반대로 충분히 가능한 진단사가 제외될 수 있다 — 이 기간을 넘는 예약은
// 자동배정·전체 브로드캐스트를 건너뛰고 관리자가 대시보드에서 직접 배정하게 둔다.
const AUTO_ASSIGN_DAYS_THRESHOLD = 5;

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
    private readonly solapiService: SolapiService,
    private readonly notificationsService: NotificationsService,
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
    const booking = this.bookingRepository.create(data);
    let saved = await this.bookingRepository.save(booking);

    const restricted = await this.isRestrictedSource(saved.source);
    // "self-{company}"는 발주사가 자기 소유 차량을 자체적으로 처리하는 건 —
    // 진단사가 실제로 방문할 필요가 없으니 자동배정도, 전체 브로드캐스트 알림도 하지 않는다.
    // (미등록 출처라서 막는 "restricted"와는 다른 개념 — 정상 등록된 발주사의 의도적 셀프 처리)
    const selfSource = !!saved.source?.startsWith('self-');
    const withinAssignWindow = this.isWithinAutoAssignWindow(saved.preferredDateTime);

    if (restricted) {
      console.log(`⛔ [배정제한] 등록되지 않은 발주사 코드(source=${saved.source}) — 자동배정·진단사 브로드캐스트 건너뜀 (건: ${saved.carNumber})`);
    } else if (selfSource) {
      console.log(`ℹ️ [자체 진단] ${saved.carNumber} — 자체 신청 건이라 진단사 자동배정/알림 없이 접수만 처리`);
    } else if (!withinAssignWindow) {
      console.log(`📅 [자동배정 보류] ${saved.carNumber} — 방문일(${saved.preferredDateTime})이 ${AUTO_ASSIGN_DAYS_THRESHOLD}일 이후라 자동배정/브로드캐스트 없이 관리자 수동배정 대기`);
    } else {
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
              ),
            ),
          );
        } catch (e) {
          // 푸시 실패해도 예약 저장은 정상 처리
        }
      }
    }

    // 오지/준오지·긴급후보 뱃지용 거리 진단 — 미등록 발주사 건은 어차피 관리자가 별도로
    // 확인해야 하니 제외, 그 외엔 자동배정 성공 여부와 무관하게 항상 계산해둔다.
    if (!restricted) {
      try {
        const flags = await this.computeDistanceFlags(saved);
        if (flags.nearestDriverKm != null || flags.urgentCandidate) {
          await this.bookingRepository.update(saved.id, flags);
          Object.assign(saved, flags);
        }
      } catch (e) {
        console.error('❌ [거리진단 계산 실패]', (e as Error).message);
      }
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

  // 특히 당일 접수(긴급) 건들이 30분 간격으로 다닥다닥 들어올 때, 같은 진단사가 물리적으로
  // 이동·진단을 마칠 시간도 없이 겹쳐서 자동배정되는 걸 막기 위한 최소 간격
  private readonly MIN_SLOT_GAP_MINUTES = 60;

  // driverId가 이미 배정/확정/완료된 건 중 같은 날짜(preferredDateTime 기준)에 이 방문시각과
  // MIN_SLOT_GAP_MINUTES보다 가까운 게 있으면 true — 물리적으로 겹치는 시간대라 후보에서 제외해야 함
  private async hasScheduleConflict(driverId: number, preferredDateTime?: string | null): Promise<boolean> {
    const match = preferredDateTime?.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/);
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

  // 편도 거리 기준 [준오지/오지] 분류 임계값 — 준오지는 발주사 가격협상 검토 대상,
  // 오지는 왕복 거리가 커서 사실상 항상 가격협상이 필요한 수준
  private readonly SEMI_REMOTE_KM = 30;
  private readonly REMOTE_KM = 70;

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
      const withLocation = drivers.filter(d => d.lat != null && d.lng != null);
      if (withLocation.length > 0) {
        const nearest = Math.min(
          ...withLocation.map(d => distanceKm(coords.lat, coords.lng, d.lat!, d.lng!)),
        );
        nearestDriverKm = Math.round(nearest * 10) / 10;
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

  // 신청 주소·가용시간에 맞는 활성 진단사를 찾아 자동배정 대상을 고른다.
  // 지역이 맞는 진단사가 아무도 없으면 null을 반환해 기존 수동배정(전체 브로드캐스트) 흐름으로 넘긴다 —
  // 엉뚱한 지역 진단사에게 억지로 배정하는 것보다 관리자가 판단하게 두는 게 안전하기 때문.
  private async tryAutoAssign(booking: Booking): Promise<{ driver: Driver; log: Record<string, unknown> } | null> {
    // isActive: false — 진단사 본인이 앱에서 "활동중지"로 꺼둔 경우(원거리 이동 중 등)
    // 근무시간(스케줄)에 걸려도 자동배정 대상에서 아예 제외
    const drivers = await this.driverRepository.find({ where: { status: 'APPROVED', isActive: true } });
    if (drivers.length === 0) return null;

    // 진단사가 설정한 지역(구/시 단위) 중 하나라도 신청 주소 문자열에 포함되면 매칭으로 간주
    const regionMatched = drivers.filter(d => (d.regions ?? []).some(r => r && booking.address?.includes(r)));
    if (regionMatched.length === 0) return null;

    // 근무시간·isActive를 통과해도 최근 30분간 위치 갱신이 없으면(앱 강제종료·백그라운드
    // 스로틀링 등으로 실제로 이탈했을 가능성) 자동배정 후보에서 제외
    const activeMatched = regionMatched
      .filter(d => isDriverActiveNow(d, booking.preferredDateTime))
      .filter(isLocationFresh);
    if (activeMatched.length === 0) return null;

    // 같은 진단사가 같은 날 방문예정시각이 너무 가까운(MIN_SLOT_GAP_MINUTES 이내) 건을 동시에
    // 뛸 수 없으므로, 이미 그 시간대 근처에 배정된 건이 있는 진단사는 이 슬롯 후보에서 제외
    const conflictChecks = await Promise.all(
      activeMatched.map(async d => ({
        driver: d,
        conflict: await this.hasScheduleConflict(d.id, booking.preferredDateTime),
      })),
    );
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
    const countFor = async (driverId: number) =>
      visitDatePart
        ? this.bookingRepository.count({
            where: {
              assignedDriverId: String(driverId),
              status: In(['ASSIGNED', 'CONFIRMED', 'COMPLETED']),
              preferredDateTime: Like(`${visitDatePart}%`),
            },
          })
        // 방문예정일 파싱 실패 시(형식 이상·미입력) 접수일 기준으로 폴백
        : this.bookingRepository.count({
            where: { assignedDriverId: String(driverId), createdAt: MoreThanOrEqual(todayStart) },
          });

    // 거리 계산 가능하면: 제일 가까운 사람 기준 +15km(왕복 30km, 준오지 기준의 절반) 이내에 있는
    // "가까운 편" 진단사들끼리는 거리보다 오늘 배정건수가 적은 사람을 우선 — 한 명한테 쏠리는 것 방지.
    // 그 반경 밖은 굳이 균등 배정 명목으로 멀리 보낼 이유가 없으니 그냥 거리순.
    const NEARBY_RADIUS_KM = 15;
    const coords = await geocodeAddress(booking.address);
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
      withCounts.sort((a, b) => a.count - b.count || a.km - b.km);

      const candidateLog = withCounts.map(({ driver, km, count }) => ({
        driverId: driver.id,
        driverName: driver.name,
        km: Math.round(km * 10) / 10,
        todayCount: count,
        maxDailyBookings: driver.maxDailyBookings ?? 5,
        atCap: count >= (driver.maxDailyBookings ?? 5),
      }));

      for (const { driver, count } of withCounts) {
        if (count < (driver.maxDailyBookings ?? 5)) {
          return {
            driver,
            log: {
              bookingAddress: booking.address,
              bookingCoords: coords,
              nearestKm: Math.round(nearestKm * 10) / 10,
              radiusKm: NEARBY_RADIUS_KM,
              candidates: candidateLog,
              chosenDriverId: driver.id,
              chosenDriverName: driver.name,
              reason: '반경 내 후보 중 오늘 배정건수가 가장 적음(동률 시 거리순)',
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
          chosenDriverId: ranked[0].driver.id,
          chosenDriverName: ranked[0].driver.name,
          reason: '반경 내 후보 전원이 하루 최대 배정건수 도달 — 그중 가장 가까운 사람에게 배정',
          assignedAt: new Date().toISOString(),
        },
      };
    }

    // 거리 계산이 안 되면(지오코딩 실패·위치정보 없음) 오늘 배정건수가 가장 적은 사람 우선
    const counts = await Promise.all(
      slotFree.map(async d => ({ driver: d, count: await countFor(d.id) })),
    );
    counts.sort((a, b) => a.count - b.count);
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
          todayCount: count,
        })),
        chosenDriverId: picked.driver.id,
        chosenDriverName: picked.driver.name,
        reason: '주소 좌표 변환 실패 또는 위치정보 있는 후보 없음 — 오늘 배정건수만으로 비교',
        assignedAt: new Date().toISOString(),
      },
    };
  }

  async findByDriver(driverId: string) {
    const bookings = await this.bookingRepository.find({
      where: { assignedDriverId: driverId },
      order: { createdAt: 'DESC' },
    });

    // datrade처럼 "수출전용"으로 표시해둔 발주사(source) 건은 진단사 앱에 "수출건" 뱃지를
    // 붙이고 진단 화면에 수출용 영상 촬영 슬롯을 노출한다 — source의 company를 뽑아서
    // 수출전용 관리자 계정 목록과 대조.
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

  // includeSelf 없이 source 미지정으로 조회하면(ChavatarApp의 전체 목록 조회가 바로 이 경우)
  // 자체 신청(self-{company}) 건은 기본적으로 제외됨 — 진단사가 방문할 필요 없는 건이
  // 앱 어느 화면에도 노출되지 않게 하기 위함(구버전 앱도 소급 적용됨). source를 명시하면
  // 정확히 일치하는 것만 가져오므로 이 필터와 무관 — "자체 진단 목록" 탭은 source에
  // "self-{company}"를 그대로 넘겨서 조회하니 영향 없음.
  async findAll(source?: string, includeSelf = false): Promise<(Booking & { carHash?: string | null; firstCompletedAt?: Date | null })[]> {
    const bookings = await this.bookingRepository.find({
      where: source ? { source } : {},
      order: { createdAt: 'DESC' },
    });
    const visible = (!source && !includeSelf)
      ? bookings.filter(b => !b.source?.startsWith('self-'))
      : bookings;

    const completedIds = visible.filter(b => b.status === 'COMPLETED').map(b => b.id);
    if (completedIds.length === 0) return visible;

    const inspections = await this.inspectionRepository.find({
      where: { bookingId: In(completedIds) },
      select: ['bookingId', 'carHash', 'firstCompletedAt'],
    });
    const hashMap = new Map(inspections.map(i => [i.bookingId, i.carHash]));
    const firstCompletedMap = new Map(inspections.map(i => [i.bookingId, i.firstCompletedAt]));

    return visible.map(b => ({
      ...b,
      carHash: hashMap.get(b.id) ?? null,
      firstCompletedAt: firstCompletedMap.get(b.id) ?? null,
    }));
  }

  async update(id: number, updateData: Partial<Booking> & { cancelReason?: string; cancelledByDriver?: boolean }): Promise<Booking> {
    const booking = await this.bookingRepository.findOneBy({ id });

    if (!booking) {
      throw new NotFoundException(`ID ${id}번에 해당하는 내역을 찾을 수 없습니다.`);
    }

    // ── 진단사가 예약 취소한 경우: 로그 기록 + PENDING 복원 ──
    if (updateData.status === 'CANCELLED' && updateData.cancelledByDriver) {
      const prevDriverId = booking.assignedDriverId;
      const prevDriverName = booking.assignedDriverName;

      // 취소 로그 저장
      if (prevDriverId) {
        await this.cancelLogRepository.save({
          driverId: prevDriverId,
          driverName: prevDriverName || '',
          bookingId: booking.id,
          carNumber: booking.carNumber,
          carOwner: booking.carOwner,
          cancelReason: updateData.cancelReason || '',
        });
      }

      // PENDING 복원 + 진단사 정보 초기화
      booking.status = 'PENDING';
      booking.assignedDriverId = null;
      booking.assignedDriverName = null;
      booking.cancelledByDriverAt = new Date();
      return await this.bookingRepository.save(booking);
    }

    // ── 관리자가 배정 초기화 (unassign) ──
    if (updateData.status === 'PENDING' && 'assignedDriverId' in updateData && !updateData.assignedDriverId) {
      booking.status = 'PENDING';
      booking.assignedDriverId = null;
      booking.assignedDriverName = null;
      booking.cancelledByDriverAt = null;
      return await this.bookingRepository.save(booking);
    }

    // 진단사가 앱 "예약 요청" 탭에서 "내 담당으로 확정하기"를 눌러 셀프클레임한 경우 —
    // handleClaim()이 보내는 시그니처(PENDING → status:CONFIRMED + assignedDriverId)만 여기 해당
    const isSelfClaim = booking.status === 'PENDING' && updateData.status === 'CONFIRMED' && !!updateData.assignedDriverId;

    Object.assign(booking, updateData);
    const updated = await this.bookingRepository.save(booking);

    if (isSelfClaim) {
      try {
        const driver = await this.driverRepository.findOne({ where: { id: Number(updateData.assignedDriverId) } });
        if (driver?.pushToken) {
          await this.notificationsService.sendPush(
            driver.pushToken,
            '(수동배정) 진단건이 확정되었습니다.',
            `${updated.carOwner}님 · ${updated.carNumber} · ${updated.preferredDateTime}`,
            { bookingId: updated.id },
          );
        }
      } catch (e) {}
    }

    return updated;
  }

  // source: 'auto'는 create()의 자동배정 성공 시에만 내부적으로 넘김 — 그 외(대시보드/지도에서
  // 관리자가 직접 배정)는 전부 기본값 'manual'로 처리되어 진단사에게 다른 문구로 알림이 감.
  async assign(id: number, driverInfo: { id: string; name: string }, source: 'auto' | 'manual' | 'agent' = 'manual', assignedByAgentId?: string) {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) throw new NotFoundException('해당 신청 내역을 찾을 수 없습니다.');

    booking.assignedDriverId = driverInfo.id;
    booking.assignedDriverName = driverInfo.name;
    booking.status = 'ASSIGNED';
    booking.cancelledByDriverAt = null; // 재배정 시 재대기 플래그 초기화
    booking.assignedByAgentId = source === 'agent' ? (assignedByAgentId ?? null) : null;

    const saved = await this.bookingRepository.save(booking);

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
}
