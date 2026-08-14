import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { Review } from './entities/review.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Driver } from '../drivers/entities/driver.entity';
import { Inspection } from '../inspection/entities/inspection.entity';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(Driver)
    private readonly driverRepository: Repository<Driver>,
    @InjectRepository(Inspection)
    private readonly inspectionRepository: Repository<Inspection>,
  ) {}

  // 홈페이지 공개 후기 카드용 — 평가사 프로필사진·차종명만 얇게 붙여준다(평가사 연락처·
  // 위치 등 민감정보가 담긴 드라이버 레코드 전체를 그대로 내려주면 안 되므로 여기서만 조합)
  private async enrichForPublic(reviews: Review[]) {
    const driverIds = [...new Set(reviews.map((r) => r.driverId).filter(Boolean))] as string[];
    const bookingIds = reviews.map((r) => r.bookingId);

    const drivers: Driver[] = driverIds.length ? await this.driverRepository.findBy({ id: In(driverIds) as any }) : [];
    const inspections: Inspection[] = bookingIds.length ? await this.inspectionRepository.findBy({ bookingId: In(bookingIds) }) : [];

    const photoByDriverId = new Map<string, string | null>();
    for (const d of drivers) photoByDriverId.set(String((d as any).id), (d as any).photoUrl ?? null);
    const modelByBookingId = new Map<number, string | null>();
    for (const i of inspections) modelByBookingId.set(i.bookingId, i.carModel ?? null);

    return reviews.map((r) => ({
      ...r,
      driverPhotoUrl: r.driverId ? photoByDriverId.get(String(r.driverId)) ?? null : null,
      carModel: modelByBookingId.get(r.bookingId) ?? null,
    }));
  }

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
      const reviews = await this.reviewRepository.find({ order: { createdAt: 'DESC' } });
      return this.enrichForPublic(reviews);
    }
    const bookings = await this.bookingRepository.find({ where: { source }, select: ['id'] });
    const bookingIds = bookings.map((b) => b.id);
    if (bookingIds.length === 0) return [];
    const reviews = await this.reviewRepository.find({
      where: { bookingId: In(bookingIds) },
      order: { createdAt: 'DESC' },
    });
    return this.enrichForPublic(reviews);
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

  // 진단사별 평균 평점 — 리뷰가 아직 없는 신규 진단사는 5점에서 시작(신뢰 배지 기본값),
  // 실제 리뷰가 쌓이면 그 평균으로 자연스럽게 깎여 내려간다.
  async getDriverStats(driverId: string) {
    const reviews = await this.reviewRepository.find({ where: { driverId } });
    if (!reviews.length) return { average: 5, total: 0 };
    const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    return { average: Math.round(avg * 10) / 10, total: reviews.length };
  }

  // /inspection 신청 페이지 평가사 카드에 보여줄 축약 후기 한 줄 — 가장 최근 리뷰의
  // 코멘트를 짧게 자르고, 코멘트가 없는 리뷰뿐이면 평점 좋은 건 귀여운 기본 문구로 대신한다.
  async getDriverHighlight(driverId: string): Promise<string | null> {
    const reviews = await this.reviewRepository.find({ where: { driverId }, order: { createdAt: 'DESC' } });
    if (!reviews.length) return null;
    const withComment = reviews.find((r) => r.comment && r.comment.trim().length > 0);
    if (withComment) {
      const text = withComment!.comment!.trim();
      return text.length > 22 ? `${text.slice(0, 22)}…` : text;
    }
    const goodReview = reviews.find((r) => r.rating >= 4);
    return goodReview ? '너무 좋았어요~ 최고예요! 🩷' : null;
  }
}
