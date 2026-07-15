import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { Booking } from '../bookings/entities/booking.entity';
import { BuyerRequest } from '../buyer-request/entities/buyer-request.entity';
import { User } from '../users/entities/user.entity';
import { Driver } from '../drivers/entities/driver.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Booking, BuyerRequest, User, Driver])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
