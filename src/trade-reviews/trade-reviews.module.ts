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
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '30d' },
    }),
  ],
  controllers: [TradeReviewsController],
  providers: [TradeReviewsService],
  exports: [TradeReviewsService],
})
export class TradeReviewsModule {}
