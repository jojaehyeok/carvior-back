import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, Like, Not, IsNull, In } from 'typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { BuyerRequest } from '../buyer-request/entities/buyer-request.entity';
import { User } from '../users/entities/user.entity';
import { Driver } from '../drivers/entities/driver.entity';

function startOf(unit: 'day' | 'week' | 'month'): Date {
  const d = new Date();
  if (unit === 'day') {
    d.setHours(0, 0, 0, 0);
  } else if (unit === 'week') {
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
  } else {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BuyerRequest)
    private readonly buyerRepo: Repository<BuyerRequest>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Driver)
    private readonly driverRepo: Repository<Driver>,
  ) {}

  // source(발주사) 주면 진단신청 통계는 그 회사 것만 집계 — 상담/회원/진단사는
  // 발주사와 무관한 전체 플랫폼 지표라 그대로 둔다(프론트에서 회사 관리자에겐 안 보여줌).
  async getStats(source?: string) {
    const [todayStart, weekStart, monthStart] = [
      startOf('day'),
      startOf('week'),
      startOf('month'),
    ];
    // 서버는 UTC로 도는데 preferredDateTime은 한국시간 문자열로 저장돼 있어서,
    // "오늘"을 KST 기준으로 직접 만든다(UTC로 비교하면 새벽/저녁 건이 하루 밀린다).
    const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const bookingBase = source ? { source } : {};

    const [
      bookingTotal,
      bookingToday,
      bookingWeek,
      bookingMonth,
      bookingPending,
      bookingAssigned,
      bookingCompleted,
      bookingCancelled,
      bookingVisitToday,
      bookingVisitTodayUnassigned,
      bookingVisitTodayList,
      recentBookings,

      consultTotal,
      consultToday,
      consultWeek,
      consultPending,

      userTotal,
      userToday,
      userWeek,

      driverApproved,
      driverPending,
    ] = await Promise.all([
      this.bookingRepo.count({ where: bookingBase }),
      this.bookingRepo.count({ where: { ...bookingBase, createdAt: MoreThanOrEqual(todayStart) } }),
      this.bookingRepo.count({ where: { ...bookingBase, createdAt: MoreThanOrEqual(weekStart) } }),
      this.bookingRepo.count({ where: { ...bookingBase, createdAt: MoreThanOrEqual(monthStart) } }),
      this.bookingRepo.count({ where: { ...bookingBase, status: 'PENDING' } }),
      this.bookingRepo.count({ where: { ...bookingBase, status: 'ASSIGNED' } }),
      this.bookingRepo.count({ where: { ...bookingBase, status: 'COMPLETED' } }),
      this.bookingRepo.count({ where: { ...bookingBase, status: 'CANCELLED' } }),
      // 오늘 방문예정 — 접수일이 아니라 "오늘 평가사가 나가는 건". preferredDateTime은
      // 소스마다 "YYYY-MM-DD HH:mm"과 "YYYY-MM-DDTHH:mm"이 섞여 있어서 날짜 앞부분만 본다.
      this.bookingRepo.count({
        where: { ...bookingBase, preferredDateTime: Like(`${todayKst}%`), status: Not('CANCELLED') },
      }),
      // 그중 아직 담당 평가사가 없는 건 — 오늘 나가야 하는데 사람이 안 정해진 것이라 제일 급하다
      this.bookingRepo.count({
        where: [
          { ...bookingBase, preferredDateTime: Like(`${todayKst}%`), status: Not('CANCELLED'), assignedDriverId: IsNull() },
          { ...bookingBase, preferredDateTime: Like(`${todayKst}%`), status: Not('CANCELLED'), assignedDriverId: '' },
        ],
      }),
      // 오늘 나가는 건 목록 자체 — 홈에서 바로 보라고 통계와 같이 내려준다.
      // 시간 순으로 줘야 "지금 몇 시 건 차례"가 한눈에 보인다.
      this.bookingRepo.find({
        where: { ...bookingBase, preferredDateTime: Like(`${todayKst}%`), status: Not('CANCELLED') },
        order: { preferredDateTime: 'ASC' },
        take: 30,
        select: ['id', 'carNumber', 'carModel', 'dealerName', 'status', 'address', 'preferredDateTime', 'assignedDriverName', 'assignedDriverId'],
      }),
      this.bookingRepo.find({
        where: bookingBase,
        order: { createdAt: 'DESC' },
        take: 8,
        select: ['id', 'carNumber', 'dealerName', 'status', 'address', 'createdAt', 'source'],
      }),

      this.buyerRepo.count(),
      this.buyerRepo.count({ where: { createdAt: MoreThanOrEqual(todayStart) } }),
      this.buyerRepo.count({ where: { createdAt: MoreThanOrEqual(weekStart) } }),
      this.buyerRepo.count({ where: { status: 'PENDING' } }),

      this.userRepo.count(),
      this.userRepo.count({ where: { createdAt: MoreThanOrEqual(todayStart) } }),
      this.userRepo.count({ where: { createdAt: MoreThanOrEqual(weekStart) } }),

      this.driverRepo.count({ where: { status: 'APPROVED' } }),
      this.driverRepo.count({ where: { status: 'PENDING' } }),
    ]);

    return {
      booking: {
        total: bookingTotal,
        today: bookingToday,
        week: bookingWeek,
        month: bookingMonth,
        byStatus: {
          PENDING: bookingPending,
          ASSIGNED: bookingAssigned,
          COMPLETED: bookingCompleted,
          CANCELLED: bookingCancelled,
        },
        // 오늘 나가는 건과 그중 담당자 없는 건 — 홈 카드에서 바로 보라고 따로 센다
        visitToday: bookingVisitToday,
        visitTodayUnassigned: bookingVisitTodayUnassigned,
        visitTodayList: bookingVisitTodayList,
        recent: recentBookings,
      },
      consultation: {
        total: consultTotal,
        today: consultToday,
        week: consultWeek,
        pendingCount: consultPending,
      },
      user: {
        total: userTotal,
        today: userToday,
        week: userWeek,
      },
      driver: {
        approved: driverApproved,
        pending: driverPending,
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
