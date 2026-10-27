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
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '30d' },
    }),
  ],
  controllers: [ReportsController, ReportsAdminController],
  providers: [ReportsService],
})
export class ReportsModule {}
