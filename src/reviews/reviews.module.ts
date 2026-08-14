import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { Review } from './entities/review.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Driver } from '../drivers/entities/driver.entity';
import { Inspection } from '../inspection/entities/inspection.entity';
import { S3Service } from '../s3/s3.service';

@Module({
  imports: [TypeOrmModule.forFeature([Review, Booking, Driver, Inspection]), ConfigModule],
  controllers: [ReviewsController],
  providers: [ReviewsService, S3Service],
  exports: [ReviewsService],
})
export class ReviewsModule {}
