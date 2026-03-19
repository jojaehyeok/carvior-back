import { Module } from '@nestjs/common';
import { InspectionService } from './inspection.service';
import { InspectionController } from './inspection.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Inspection } from './entities/inspection.entity';
import { Booking } from 'src/bookings/entities/booking.entity';

@Module({
  imports: [
    // 👈 사용할 엔티티들을 여기에 등록해줘야 Repository 주입이 가능합니다!
    TypeOrmModule.forFeature([Inspection, Booking]),
  ],
  controllers: [InspectionController],
  providers: [InspectionService],
})
export class InspectionModule { }
