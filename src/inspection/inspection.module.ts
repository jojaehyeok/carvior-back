import { Module } from '@nestjs/common';
import { InspectionService } from './inspection.service';
import { InspectionController } from './inspection.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Inspection } from './entities/inspection.entity';
import { Booking } from 'src/bookings/entities/booking.entity';
import { SolapiService } from 'src/solapi/solapi.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Inspection, Booking]),
  ],
  controllers: [InspectionController],
  providers: [InspectionService, SolapiService],
})
export class InspectionModule { }
