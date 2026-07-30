import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { BookingsRedirectController } from './bookings-redirect.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { SolapiService } from 'src/solapi/solapi.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { Driver } from 'src/drivers/entities/driver.entity';
import { DriverCancelLog } from 'src/driver-cancel-logs/driver-cancel-log.entity';
import { Inspection } from 'src/inspection/entities/inspection.entity';
import { User } from 'src/users/entities/user.entity';
import { S3Service } from 'src/s3/s3.service';
import { SmsBillingLog } from 'src/sms-billing-logs/sms-billing-log.entity';
import { DriverAssignmentPenalty } from 'src/driver-assignment-penalties/driver-assignment-penalty.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Driver, DriverCancelLog, Inspection, User, SmsBillingLog, DriverAssignmentPenalty]),
    ConfigModule,
  ],
  controllers: [BookingsController, BookingsRedirectController],
  providers: [BookingsService, SolapiService, NotificationsService, S3Service],
})
export class BookingsModule { }
