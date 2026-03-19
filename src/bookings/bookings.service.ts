import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { SolapiService } from '../solapi/solapi.service'; // 1. 임포트 추가

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    private readonly solapiService: SolapiService, // 2. 의존성 주입 추가!
  ) { }

  async create(data: Partial<Booking>): Promise<Booking> {
    const booking = this.bookingRepository.create(data);
    return await this.bookingRepository.save(booking);
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