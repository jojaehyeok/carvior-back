import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
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

  async getStats() {
    const [todayStart, weekStart, monthStart] = [
      startOf('day'),
      startOf('week'),
      startOf('month'),
    ];

    const [
      bookingTotal,
      bookingToday,
      bookingWeek,
      bookingMonth,
      bookingPending,
      bookingAssigned,
      bookingCompleted,
      bookingCancelled,
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
      this.bookingRepo.count(),
      this.bookingRepo.count({ where: { createdAt: MoreThanOrEqual(todayStart) } }),
      this.bookingRepo.count({ where: { createdAt: MoreThanOrEqual(weekStart) } }),
      this.bookingRepo.count({ where: { createdAt: MoreThanOrEqual(monthStart) } }),
      this.bookingRepo.count({ where: { status: 'PENDING' } }),
      this.bookingRepo.count({ where: { status: 'ASSIGNED' } }),
      this.bookingRepo.count({ where: { status: 'COMPLETED' } }),
      this.bookingRepo.count({ where: { status: 'CANCELLED' } }),
      this.bookingRepo.find({
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
