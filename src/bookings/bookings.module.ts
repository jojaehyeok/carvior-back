import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { SolapiService } from 'src/solapi/solapi.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { Driver } from 'src/drivers/entities/driver.entity';
import { DriverCancelLog } from 'src/driver-cancel-logs/driver-cancel-log.entity';
import { Inspection } from 'src/inspection/entities/inspection.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Driver, DriverCancelLog, Inspection]),
  ],
  controllers: [BookingsController],
  providers: [BookingsService, SolapiService, NotificationsService],
})
export class BookingsModule { }
