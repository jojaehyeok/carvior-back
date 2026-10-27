import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ChatService } from './chat.service';
import { userIdFromToken } from './chat-auth';

// 개인 직거래 매물 문의 채팅 — 실시간 주고받기는 웹소켓(ChatGateway)이 하고,
// 여기서는 방 목록·지난 대화 불러오기처럼 화면을 처음 그릴 때 필요한 것만 다룬다.
@Controller('v1/chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly jwt: JwtService,
  ) {}

  // 매물 상세의 "문의하기" — 이미 대화한 적 있으면 그 방을 그대로 돌려준다
  @Post('rooms')
  async openRoom(@Headers('authorization') auth: string, @Body('storeItemId') storeItemId: number) {
    const userId = userIdFromToken(this.jwt, auth);
    const room = await this.chat.openRoom(Number(storeItemId), userId);
    return { roomId: room.id };
  }

  @Get('rooms')
  listRooms(@Headers('authorization') auth: string) {
    return this.chat.listRooms(userIdFromToken(this.jwt, auth));
  }

  @Get('rooms/:id')
  getRoom(@Headers('authorization') auth: string, @Param('id') id: string) {
    return this.chat.getRoom(Number(id), userIdFromToken(this.jwt, auth));
  }

  @Get('rooms/:id/messages')
  listMessages(@Headers('authorization') auth: string, @Param('id') id: string) {
    return this.chat.listMessages(Number(id), userIdFromToken(this.jwt, auth));
  }

  // 방을 열어두고 있으면 웹소켓이 읽음 처리를 하지만, 새로고침 등으로 들어올 땐 여기로 한 번 찍는다
  @Post('rooms/:id/read')
  async markRead(@Headers('authorization') auth: string, @Param('id') id: string) {
    await this.chat.markRead(Number(id), userIdFromToken(this.jwt, auth));
    return { ok: true };
  }
}
