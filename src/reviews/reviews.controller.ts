import {
  Controller, Post, Get, Body, Param,
  UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ReviewsService } from './reviews.service';
import { S3Service } from '../s3/s3.service';
import { extname } from 'path';

@Controller('v1/reviews')
export class ReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly s3Service: S3Service,
  ) {}

  // 고객이 리뷰 제출 (사진 최대 3장)
  @Post()
  @UseInterceptors(
    FilesInterceptor('photos', 3, { storage: memoryStorage() }),
  )
  async create(
    @Body() body: any,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const photoUrls: string[] = [];
    if (files && files.length > 0) {
      for (const file of files) {
        const key = `reviews/${body.bookingId}/${Date.now()}${extname(file.originalname)}`;
        const url = await this.s3Service.uploadFile(file, key);
        photoUrls.push(url);
      }
    }

    return await this.reviewsService.create({
      bookingId: Number(body.bookingId),
      driverId: body.driverId,
      driverName: body.driverName,
      carNumber: body.carNumber,
      carOwner: body.carOwner,
      rating: Number(body.rating),
      comment: body.comment,
      photoUrls,
    });
  }

  // 대시보드 전체 리뷰 목록
  @Get()
  async findAll() {
    return await this.reviewsService.findAll();
  }

  // 진단사 오늘 CS 현황
  @Get('driver/:driverId/today')
  async todayByDriver(@Param('driverId') driverId: string) {
    const reviews = await this.reviewsService.findTodayByDriver(driverId);
    const stats = await this.reviewsService.getDriverStats(driverId);
    return { reviews, stats };
  }

  // 진단사 전체 평점 통계
  @Get('driver/:driverId/stats')
  async driverStats(@Param('driverId') driverId: string) {
    return await this.reviewsService.getDriverStats(driverId);
  }
}
