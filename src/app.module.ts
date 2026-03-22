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
import { DriversService } from './drivers/drivers.service';
import { DriversModule } from './drivers/drivers.module';
import { AuthController } from './auth/auth.controller';

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

        // 🚀 수정 1: 직접 클래스를 넣는 대신 파일 패턴으로 찾기
        // 빌드된 후의 js 파일들을 다 긁어오도록 설정합니다.
        entities: [__dirname + '/**/*.entity{.ts,.js}'],

        // 🚀 수정 2: 테스트를 위해 강제로 true 설정
        // 테이블이 생기는 걸 확인한 후에 다시 configService 로직으로 바꾸셔도 됩니다.
        synchronize: true,

        logging: true, // 쿼리가 실행되는지 로그로 확인 가능
        // keepConnectionAlive: true,
      }),
    }),
    BookingsModule,
    InspectionModule,
    DriversModule
  ],
  controllers: [AppController, AuthController],
  providers: [AppService, SolapiService, S3Service, DriversService],
})
export class AppModule { }
