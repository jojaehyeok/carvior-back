import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BookingsModule } from './bookings/bookings.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SolapiService } from './solapi/solapi.service';
import { InspectionModule } from './inspection/inspection.module';
import { S3Service } from './s3/s3.service';

// ✅ 엔티티들을 하나씩 추가하기 귀찮으니 아래처럼 와일드카드를 쓰거나 리스트에 추가합니다.
import { Booking } from './bookings/entities/booking.entity';
import { Inspection } from './inspection/entities/inspection.entity'; 

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

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
        
        // 🚀 수정 포인트: 엔티티 배열에 Inspection 추가
        // 또는 [__dirname + '/**/*.entity{.ts,.js}'] 를 사용하면 폴더 내 모든 엔티티 자동 로드
        entities: [__dirname + '/**/*.entity{.ts,.js}'], 
        
        // 운영 환경이 아니면 synchronize를 통해 테이블을 자동 생성합니다.
        synchronize: configService.get<string>('NODE_ENV') !== 'production', 
        logging: true, 
      }),
    }),
    BookingsModule,
    InspectionModule
  ],
  controllers: [AppController],
  providers: [AppService, SolapiService, S3Service],
})
export class AppModule { }