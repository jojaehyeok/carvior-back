import { Module } from '@nestjs/common';
import { InspectionService } from './inspection.service';
import { InspectionController } from './inspection.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Inspection } from './entities/inspection.entity';
import { Booking } from 'src/bookings/entities/booking.entity';
import { User } from 'src/users/entities/user.entity';
import { SmsBillingLog } from 'src/sms-billing-logs/sms-billing-log.entity';
import { SolapiService } from 'src/solapi/solapi.service';
import { DriversModule } from 'src/drivers/drivers.module';
import { ComplianceModule } from 'src/compliance/compliance.module';
import { ScheduledNotificationsModule } from 'src/scheduled-notifications/scheduled-notifications.module';
import { TranslateModule } from 'src/translate/translate.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Inspection, Booking, User, SmsBillingLog]),
    DriversModule,
    ComplianceModule,
    ScheduledNotificationsModule,
    TranslateModule,
  ],
  controllers: [InspectionController],
  providers: [InspectionService, SolapiService],
})
export class InspectionModule { }
