import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BuyerRequest } from './entities/buyer-request.entity';
import { BuyerRequestService } from './buyer-request.service';
import { BuyerRequestController } from './buyer-request.controller';
import { SolapiService } from '../solapi/solapi.service';
import { Booking } from '../bookings/entities/booking.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BuyerRequest, Booking])],
  controllers: [BuyerRequestController],
  providers: [BuyerRequestService, SolapiService],
})
export class BuyerRequestModule {}
