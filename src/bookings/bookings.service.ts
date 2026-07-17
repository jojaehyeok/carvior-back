/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { SolapiService } from '../solapi/solapi.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Driver } from '../drivers/entities/driver.entity';
import { DriverCancelLog } from '../driver-cancel-logs/driver-cancel-log.entity';
import { Inspection } from '../inspection/entities/inspection.entity';
import { distanceKm, geocodeAddress, isDriverActiveNow } from './auto-assign.util';

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
    private readonly solapiService: SolapiService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async checkOngoingBooking(carNumber: string): Promise<boolean> {
    const cleanCarNumber = carNumber.replace(/\s/g, '');
    const existing = await this.bookingRepository.findOne({
      where: {
        carNumber: cleanCarNumber,
        status: Not(In(['COMPLETED', 'CANCELLED'])),
      },
    });
    return !!existing;
  }

  async create(data: Partial<Booking>): Promise<Booking> {
    const booking = this.bookingRepository.create(data);
    let saved = await this.bookingRepository.save(booking);

    // 지역·가용시간 맞는 활성 진단사가 있으면 즉시 자동배정, 없으면 기존처럼 전체 브로드캐스트로 폴백
    let assignedDriver: Driver | null = null;
    try {
      assignedDriver = await this.tryAutoAssign(saved);
    } catch (e) {
      // 자동배정 실패는 접수 자체를 막으면 안 됨 — 아래 폴백(전체 브로드캐스트)으로 처리
    }

    if (assignedDriver) {
      saved = await this.assign(saved.id, { id: String(assignedDriver.id), name: assignedDriver.name });
      console.log(`🤖 [자동배정] ${saved.carNumber} → ${assignedDriver.name}(${assignedDriver.id})`);
    } else {
      // 자동배정 대상이 없으면 승인된 진단사 전원에게 새 접수 푸시 발송(기존 동작)
      try {
        const drivers = await this.driverRepository.find({
          where: { status: 'APPROVED' },
        });
        const pushTargets = drivers.filter(d => d.pushToken);
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

    // 관리자(01022856017)에게 새 예약 접수 알림톡 발송 (자동배정 여부와 무관하게 항상 발송)
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

    return saved;
  }

  // 신청 주소·가용시간에 맞는 활성 진단사를 찾아 자동배정 대상을 고른다.
  // 지역이 맞는 진단사가 아무도 없으면 null을 반환해 기존 수동배정(전체 브로드캐스트) 흐름으로 넘긴다 —
  // 엉뚱한 지역 진단사에게 억지로 배정하는 것보다 관리자가 판단하게 두는 게 안전하기 때문.
  private async tryAutoAssign(booking: Booking): Promise<Driver | null> {
    const drivers = await this.driverRepository.find({ where: { status: 'APPROVED' } });
    if (drivers.length === 0) return null;

    // 진단사가 설정한 지역(구/시 단위) 중 하나라도 신청 주소 문자열에 포함되면 매칭으로 간주
    const regionMatched = drivers.filter(d => (d.regions ?? []).some(r => r && booking.address?.includes(r)));
    if (regionMatched.length === 0) return null;

    const activeMatched = regionMatched.filter(isDriverActiveNow);
    if (activeMatched.length === 0) return null;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const countFor = async (driverId: number) =>
      this.bookingRepository.count({
        where: { assignedDriverId: String(driverId), createdAt: MoreThanOrEqual(todayStart) },
      });

    // 거리 계산 가능하면 가까운 순 우선, 그중 하루 최대 배정건수 안 찬 사람을 고름
    const coords = await geocodeAddress(booking.address);
    const withLocation = activeMatched.filter(d => d.lat != null && d.lng != null);
    if (coords && withLocation.length > 0) {
      const ranked = withLocation
        .map(d => ({ driver: d, km: distanceKm(coords.lat, coords.lng, d.lat!, d.lng!) }))
        .sort((a, b) => a.km - b.km);
      for (const { driver } of ranked) {
        const count = await countFor(driver.id);
        if (count < (driver.maxDailyBookings ?? 5)) return driver;
      }
      return ranked[0].driver; // 전원 마감이어도 그중 제일 가까운 사람에게 배정
    }

    // 거리 계산이 안 되면(지오코딩 실패·위치정보 없음) 오늘 배정건수가 가장 적은 사람 우선
    const counts = await Promise.all(
      activeMatched.map(async d => ({ driver: d, count: await countFor(d.id) })),
    );
    counts.sort((a, b) => a.count - b.count);
    return counts[0]?.driver ?? null;
  }

  async findByDriver(driverId: string) {
    return await this.bookingRepository.find({
      where: { assignedDriverId: driverId },
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(source?: string): Promise<(Booking & { carHash?: string | null; firstCompletedAt?: Date | null })[]> {
    const bookings = await this.bookingRepository.find({
      where: source ? { source } : {},
      order: { createdAt: 'DESC' },
    });

    const completedIds = bookings.filter(b => b.status === 'COMPLETED').map(b => b.id);
    if (completedIds.length === 0) return bookings;

    const inspections = await this.inspectionRepository.find({
      where: { bookingId: In(completedIds) },
      select: ['bookingId', 'carHash', 'firstCompletedAt'],
    });
    const hashMap = new Map(inspections.map(i => [i.bookingId, i.carHash]));
    const firstCompletedMap = new Map(inspections.map(i => [i.bookingId, i.firstCompletedAt]));

    return bookings.map(b => ({
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

    Object.assign(booking, updateData);
    const updated = await this.bookingRepository.save(booking);

    if (updateData.status === 'CONFIRMED') {
      try {
        const driver = updated.assignedDriverId
          ? await this.driverRepository.findOne({ where: { accountId: updated.assignedDriverId } })
          : null;

        const driverPhone = driver?.phone || updated.contact;
        const driverName = updated.assignedDriverName || driver?.name || '진단사';

        const kakaoVariables = {
          '#{진단사명}': driverName,
          '#{진단사연락처}': driverPhone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3'),
          '#{차량번호}': updated.carNumber,
        };
        await this.solapiService.sendAlimTalk(driverPhone, kakaoVariables);
        console.log(`✅ [알림톡 발송] 진단사 ${driverName}(${driverPhone})께 배정 알림 전송`);
      } catch (error: unknown) {
        console.error('❌ [알림톡 발송 실패]', (error as Error).message);
      }
    }

    return updated;
  }

  async assign(id: number, driverInfo: { id: string; name: string }) {
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) throw new NotFoundException('해당 신청 내역을 찾을 수 없습니다.');

    booking.assignedDriverId = driverInfo.id;
    booking.assignedDriverName = driverInfo.name;
    booking.status = 'ASSIGNED';
    booking.cancelledByDriverAt = null; // 재배정 시 재대기 플래그 초기화

    const saved = await this.bookingRepository.save(booking);

    try {
      const driver = await this.driverRepository.findOne({ where: { id: Number(driverInfo.id) } });
      if (driver?.pushToken) {
        await this.notificationsService.sendPush(
          driver.pushToken,
          '새 예약이 배정되었습니다 🚗',
          `${saved.carOwner}님 · ${saved.carNumber} · ${saved.preferredDateTime}`,
          { bookingId: saved.id },
        );
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
}
