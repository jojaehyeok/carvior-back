import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { SolapiService } from '../solapi/solapi.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Driver } from '../drivers/entities/driver.entity';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(Driver)
    private readonly driverRepository: Repository<Driver>,
    private readonly solapiService: SolapiService,
    private readonly notificationsService: NotificationsService,
  ) { }

  // ✅ 진행 중인 예약이 있는지 확인하는 메서드
  async checkOngoingBooking(carNumber: string): Promise<boolean> {
    // 공백 제거 (DB 조회 정확도)
    const cleanCarNumber = carNumber.replace(/\s/g, '');

    const existing = await this.bookingRepository.findOne({
      where: {
        carNumber: cleanCarNumber,
        // 상태가 'COMPLETED'나 'CANCELLED'가 아닌 것들만 찾음
        status: Not(In(['COMPLETED', 'CANCELLED'])),
      },
    });

    return !!existing; // 존재하면 true, 없으면 false
  }

  async create(data: Partial<Booking>): Promise<Booking> {
    const booking = this.bookingRepository.create(data);
    return await this.bookingRepository.save(booking);
  }

  // ✅ Step 4: 특정 진단사 ID로 예약 목록 조회
  // 🚀 수정 포인트: driverId를 인자로 받아 해당 진단사 것만 조회합니다.
  async findByDriver(driverId: string) {
    return await this.bookingRepository.find({
      where: { assignedDriverId: driverId }, // DB에서 내 ID가 찍힌 것만!
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(): Promise<Booking[]> {
    return await this.bookingRepository.find({
      order: { createdAt: 'DESC' },
    });
  }


  async update(id: number, updateData: Partial<Booking>): Promise<Booking> {
    const booking = await this.bookingRepository.findOneBy({ id });

    if (!booking) {
      throw new NotFoundException(`ID ${id}번에 해당하는 내역을 찾을 수 없습니다.`);
    }

    // 데이터 업데이트
    Object.assign(booking, updateData);
    const updated = await this.bookingRepository.save(booking);

    // ✅ 상태가 'CONFIRMED'로 변경될 때만 알림톡 발송
    if (updateData.status === 'CONFIRMED') {
      try {
        // 템플릿 변수와 1:1 매칭
        const kakaoVariables = {
          '#{진단사명}': updated.assignedDriverName || '조재혁 진단사',
          '#{진단사연락처}': '010-2285-6017', // 실제 진단사 번호 (나중에 유동적으로 변경 가능)
          '#{차량번호}': updated.carNumber
        };

        await this.solapiService.sendAlimTalk(updated.contact, kakaoVariables);
        console.log(`✅ [알림톡 발송 성공] ${updated.carOwner}님께 배정 알림 전송`);

      } catch (error: unknown) {
        console.error('❌ [알림톡 발송 실패]', (error as Error).message);
        // 알림톡이 실패해도 예약 상태는 이미 DB에 반영된 상태입니다.
      }
    }

    return updated;
  }

  // ✅ 배정 함수 추가
  // ✅ 진단사 배정 로직 (컬럼명: assignedDriverId, assignedDriverName)
  async assign(id: number, driverInfo: { id: string; name: string }) {
    // 1. 해당 신청건 찾기
    const booking = await this.bookingRepository.findOne({ where: { id } });
    if (!booking) {
      throw new NotFoundException('해당 신청 내역을 찾을 수 없습니다.');
    }

    // 2. 데이터 업데이트
    booking.assignedDriverId = driverInfo.id;
    booking.assignedDriverName = driverInfo.name;
    booking.status = 'ASSIGNED';

    const saved = await this.bookingRepository.save(booking);

    // 배정된 진단사에게 앱 푸시 알림 발송
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
    } catch (e) {
      // push 실패해도 배정은 정상 처리
    }

    return saved;
  }
}