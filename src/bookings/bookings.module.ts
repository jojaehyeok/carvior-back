import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { BookingsRedirectController } from './bookings-redirect.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { SolapiService } from 'src/solapi/solapi.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { Driver } from 'src/drivers/entities/driver.entity';
import { DriverCancelLog } from 'src/driver-cancel-logs/driver-cancel-log.entity';
import { Inspection } from 'src/inspection/entities/inspection.entity';
import { User } from 'src/users/entities/user.entity';
import { S3Service } from 'src/s3/s3.service';
import { SmsBillingLog } from 'src/sms-billing-logs/sms-billing-log.entity';
import { DriverAssignmentPenalty } from 'src/driver-assignment-penalties/driver-assignment-penalty.entity';
import { ReviewsModule } from 'src/reviews/reviews.module';
import { IntakeParserService } from './intake-parser.service';
import { OcrModule } from 'src/ocr/ocr.module';
import { CarSpecModule } from 'src/car-spec/car-spec.module';
import { AdminGuard } from 'src/auth/admin.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Driver, DriverCancelLog, Inspection, User, SmsBillingLog, DriverAssignmentPenalty]),
    ConfigModule,
    ReviewsModule,
    OcrModule,
    CarSpecModule,
    // AdminGuard가 대시보드 로그인 토큰을 검증한다 — users.module.ts와 **같은** JWT_SECRET이어야
    // 한다(그 토큰을 발급하는 곳이 users.service.ts의 issueToken이다).
    // register()가 아니라 registerAsync()여야 하는 이유는 users.module.ts의 주석 참고 —
    // register()는 .env가 로드되기 전에 평가돼서 secret이 undefined로 굳는다.
    JwtModule.registerAsync({
      useFactory: () => ({ secret: process.env.JWT_SECRET, signOptions: { expiresIn: '30d' } }),
    }),
  ],
  controllers: [BookingsController, BookingsRedirectController],
  providers: [BookingsService, SolapiService, NotificationsService, S3Service, IntakeParserService, AdminGuard],
  exports: [BookingsService],
})
export class BookingsModule { }
