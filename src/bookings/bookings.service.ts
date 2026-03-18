import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
  ) {}

  // 단일 생성 (프론트엔드 신청용)
  async create(data: Partial<Booking>): Promise<Booking> {
    const booking = this.bookingRepository.create(data);
    return await this.bookingRepository.save(booking);
  }

  // 전체 조회 (관리자 페이지용 - 여기서 Booking[] 배열 타입 사용)
  async findAll(): Promise<Booking[]> {
    return await this.bookingRepository.find({
      order: { createdAt: 'DESC' }, // 최신순 정렬
    });
  }
}