import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
  ) {}

  // 1. 신규 신청 저장 (POST용)
  async create(data: Partial<Booking>): Promise<Booking> {
    const booking = this.bookingRepository.create(data);
    return await this.bookingRepository.save(booking);
  }

  // 2. 전체 리스트 조회 (GET /list용)
  async findAll(): Promise<Booking[]> {
    return await this.bookingRepository.find({
      order: { createdAt: 'DESC' }, // 최신순 정렬
    });
  }

  // ✅ 3. 상태 변경 및 메모 업데이트 (PATCH용 - 이게 없어서 에러난 겁니다!)
  async update(id: number, updateData: Partial<Booking>): Promise<Booking> {
    const booking = await this.bookingRepository.findOneBy({ id });
    
    if (!booking) {
      throw new NotFoundException(`ID ${id}번에 해당하는 내역을 찾을 수 없습니다.`);
    }

    // 데이터 병합 및 저장
    Object.assign(booking, updateData);
    return await this.bookingRepository.save(booking);
  }
}