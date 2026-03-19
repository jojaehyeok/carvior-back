import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BookingsModule } from './bookings/bookings.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './bookings/entities/booking.entity';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SolapiService } from './solapi/solapi.service';
import { InspectionModule } from './inspection/inspection.module';
import { S3Service } from './s3/s3.service';

@Module({
  imports: [
  // 1. ConfigModule 설정 (글로벌 전역 설정)
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // 2. TypeOrmModule 설정 (환경변수 로드)
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT', 3306),
        username: configService.get<string>('DB_USER'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_NAME'),
        entities: [Booking],
        synchronize: configService.get<string>('NODE_ENV') !== 'production', // 운영 환경에선 false 권장
        logging: true, // 쿼리 로그 확인용 (선택)
      }),
    }),
    BookingsModule,
    InspectionModule
  ],
  controllers: [AppController],
  providers: [AppService, SolapiService, S3Service],
})
export class AppModule { }
