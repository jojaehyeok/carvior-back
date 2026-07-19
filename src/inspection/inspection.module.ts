import { Module } from '@nestjs/common';
import { InspectionService } from './inspection.service';
import { InspectionController } from './inspection.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Inspection } from './entities/inspection.entity';
import { Booking } from 'src/bookings/entities/booking.entity';
import { SolapiService } from 'src/solapi/solapi.service';
import { DriversModule } from 'src/drivers/drivers.module';
import { ComplianceModule } from 'src/compliance/compliance.module';
import { ScheduledNotificationsModule } from 'src/scheduled-notifications/scheduled-notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Inspection, Booking]),
    DriversModule,
    ComplianceModule,
    ScheduledNotificationsModule,
  ],
  controllers: [InspectionController],
  providers: [InspectionService, SolapiService],
})
export class InspectionModule { }
