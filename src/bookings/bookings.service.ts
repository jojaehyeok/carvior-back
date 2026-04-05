/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { SolapiService } from '../solapi/solapi.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Driver } from '../drivers/entities/driver.entity';
import { DriverCancelLog } from '../driver-cancel-logs/driver-cancel-log.entity';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(Driver)
    private readonly driverRepository: Repository<Driver>,
    @InjectRepository(DriverCancelLog)
    private readonly cancelLogRepository: Repository<DriverCancelLog>,
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
    return await this.bookingRepository.save(booking);
  }

  async findByDriver(driverId: string) {
    return await this.bookingRepository.find({
      where: { assignedDriverId: driverId },
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(source?: string): Promise<Booking[]> {
    return await this.bookingRepository.find({
      where: source ? { source } : {},
      order: { createdAt: 'DESC' },
    });
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
