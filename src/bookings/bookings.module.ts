import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { SolapiService } from 'src/solapi/solapi.service';

@Module({
  imports: [
    // ⭐ 이 부분이 핵심입니다. 엔티티를 이 모듈에서 쓰겠다고 선언해야 합니다.
    TypeOrmModule.forFeature([Booking])
  ],
  controllers: [BookingsController],
  providers: [BookingsService, SolapiService],
})
export class BookingsModule { }
