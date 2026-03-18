import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BookingsModule } from './bookings/bookings.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './bookings/entities/booking.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: 'localhost', // 같은 서버면 localhost, 외부면 IP 주소
      port: 3306,
      username: 'jjhst2285',
      password: '3289',
      database: 'chavata_db',
      entities: [Booking],
      synchronize: true, // ⚠️ 개발 환경에서만 true: 엔티티 수정 시 DB 테이블 자동 업데이트
    }),
    BookingsModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
