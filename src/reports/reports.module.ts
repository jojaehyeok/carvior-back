import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Report } from './entities/report.entity';
import { ChatRoom } from '../chat/entities/chat-room.entity';
import { StoreItem } from '../store-items/entities/store-item.entity';
import { User } from '../users/entities/user.entity';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ReportsAdminController } from './reports-admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Report, ChatRoom, StoreItem, User]),
    // 채팅과 같은 비밀키여야 한다(같은 로그인 토큰을 검증한다)
    // ⚠ register()가 아니라 registerAsync()여야 한다.
    // register()에 넘긴 객체는 이 파일을 import하는 시점에 평가되는데, 그때는
    // ConfigModule.forRoot()가 .env를 아직 안 읽어서 process.env.JWT_SECRET이
    // undefined로 굳어버린다. 그러면 sign()이 "secretOrPrivateKey must have a value"로
    // 던지고, users.service의 issueToken()이 그걸 삼켜 빈 토큰을 내준다.
    // (2026-11-16: 이것 때문에 채팅이 "계정을 찾을 수 없습니다"로 며칠 막혀 있었다)
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  controllers: [ReportsController, ReportsAdminController],
  providers: [ReportsService],
})
export class ReportsModule {}
