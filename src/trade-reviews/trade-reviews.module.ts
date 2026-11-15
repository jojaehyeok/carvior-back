import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { TradeReview } from './entities/trade-review.entity';
import { ChatRoom } from '../chat/entities/chat-room.entity';
import { User } from '../users/entities/user.entity';
import { TradeReviewsService } from './trade-reviews.service';
import { TradeReviewsController } from './trade-reviews.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([TradeReview, ChatRoom, User]),
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
  controllers: [TradeReviewsController],
  providers: [TradeReviewsService],
  exports: [TradeReviewsService],
})
export class TradeReviewsModule {}
