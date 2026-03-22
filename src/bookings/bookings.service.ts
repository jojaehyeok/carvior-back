import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { SolapiService } from '../solapi/solapi.service'; // 1. 임포트 추가

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    private readonly solapiService: SolapiService, // 2. 의존성 주입 추가!
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
  async findByDriver(driverId: string) {
    return await this.bookingRepository.find({
      where: { assignedDriverId: driverId }, // assignedDriverId 컬럼이 예약 테이블에 있어야 함
      order: { createdAt: 'DESC' }
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

      } catch (error) {
        console.error('❌ [알림톡 발송 실패]', error.message);
        // 알림톡이 실패해도 예약 상태는 이미 DB에 반영된 상태입니다.
      }
    }

    return updated;
  }
}