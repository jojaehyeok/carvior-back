import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TradeReviewsService } from './trade-reviews.service';
import { userIdFromToken } from '../chat/chat-auth';

// 개인 직거래 후기 — 거래완료된 대화방에서만 남길 수 있다(권한 확인은 서비스에서).
@Controller('v1/trade-reviews')
export class TradeReviewsController {
  constructor(
    private readonly reviews: TradeReviewsService,
    private readonly jwt: JwtService,
  ) {}

  @Post('rooms/:roomId')
  create(
    @Headers('authorization') auth: string,
    @Param('roomId') roomId: string,
    @Body() body: { rating: number; text?: string },
  ) {
    return this.reviews.create(Number(roomId), userIdFromToken(this.jwt, auth), body);
  }

  @Get('rooms/:roomId')
  forRoom(@Headers('authorization') auth: string, @Param('roomId') roomId: string) {
    return this.reviews.forRoom(Number(roomId), userIdFromToken(this.jwt, auth));
  }

  // 판매자 후기는 로그인 없이도 볼 수 있어야 한다(매물을 보는 단계에서 필요한 정보다).
  // 이름은 첫 글자만 내려간다.
  @Get('users/:userId')
  listFor(@Param('userId') userId: string) {
    return this.reviews.listFor(Number(userId));
  }
}
