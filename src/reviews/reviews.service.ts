import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { Review } from './entities/review.entity';
import { Booking } from '../bookings/entities/booking.entity';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
  ) {}

  async create(data: {
    bookingId: number;
    driverId?: string;
    driverName?: string;
    carNumber?: string;
    carOwner?: string;
    rating: number;
    comment?: string;
    photoUrls?: string[];
  }) {
    const existing = await this.reviewRepository.findOne({ where: { bookingId: data.bookingId } });
    if (existing) throw new ConflictException('이미 리뷰가 작성된 예약입니다.');

    const review = this.reviewRepository.create(data);
    return await this.reviewRepository.save(review);
  }

  // source(발주사)를 주면 그 회사 의뢰의 리뷰만 반환 — Review엔 source가 없어서
  // bookingId로 Booking을 먼저 조회해 매칭한다(대시보드 회사별 CS리뷰 스코프용).
  async findAll(source?: string) {
    if (!source) {
      return await this.reviewRepository.find({ order: { createdAt: 'DESC' } });
    }
    const bookings = await this.bookingRepository.find({ where: { source }, select: ['id'] });
    const bookingIds = bookings.map((b) => b.id);
    if (bookingIds.length === 0) return [];
    return await this.reviewRepository.find({
      where: { bookingId: In(bookingIds) },
      order: { createdAt: 'DESC' },
    });
  }

  // 특정 진단사의 오늘 완료분 리뷰
  async findTodayByDriver(driverId: string) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    return await this.reviewRepository.find({
      where: { driverId, createdAt: Between(start, end) },
      order: { createdAt: 'DESC' },
    });
  }

  // 진단사별 평균 평점
  async getDriverStats(driverId: string) {
    const reviews = await this.reviewRepository.find({ where: { driverId } });
    if (!reviews.length) return { average: 0, total: 0 };
    const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    return { average: Math.round(avg * 10) / 10, total: reviews.length };
  }
}
