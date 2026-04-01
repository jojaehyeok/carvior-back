import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { Review } from './entities/review.entity';
import { S3Service } from '../s3/s3.service';

@Module({
  imports: [TypeOrmModule.forFeature([Review]), ConfigModule],
  controllers: [ReviewsController],
  providers: [ReviewsService, S3Service],
  exports: [ReviewsService],
})
export class ReviewsModule {}
