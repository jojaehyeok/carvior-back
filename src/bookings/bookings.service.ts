import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
  ) { }

  // 단일 생성 (프론트엔드 신청용)
  async create(data: Partial<Booking>): Promise<Booking> {
    const booking = this.bookingRepository.create(data);
    return await this.bookingRepository.save(booking);
  }

  // ✅ 추가해야 할 update 메서드
  async update(id: number, updateData: Partial<Booking>): Promise<Booking> {
    // 1. 해당 데이터가 있는지 먼저 확인
    const booking = await this.bookingRepository.findOneBy({ id });
    if (!booking) {
      throw new NotFoundException(`ID ${id}번에 해당하는 신청 내역이 없습니다.`);
    }

    // 2. 데이터 업데이트 (Object.assign으로 기존 객체에 덮어쓰기)
    Object.assign(booking, updateData);

    // 3. 저장 후 반환
    return await this.bookingRepository.save(booking);
  }

  // 전체 조회 (관리자 페이지용 - 여기서 Booking[] 배열 타입 사용)
  async findAll(): Promise<Booking[]> {
    return await this.bookingRepository.find({
      order: { createdAt: 'DESC' }, // 최신순 정렬
    });
  }
}