import { Module } from '@nestjs/common';
import { InspectionPaymentsController } from './inspection-payments.controller';
import { InspectionPaymentsService } from './inspection-payments.service';
import { BookingsModule } from '../bookings/bookings.module';
import { SolapiService } from '../solapi/solapi.service';

@Module({
  imports: [BookingsModule],
  controllers: [InspectionPaymentsController],
  providers: [InspectionPaymentsService, SolapiService],
})
export class InspectionPaymentsModule {}
