import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { userIdFromToken } from './chat-auth';

// 개인 직거래 매물 문의 채팅 — 실시간 주고받기는 웹소켓(ChatGateway)이 하고,
// 여기서는 방 목록·지난 대화 불러오기처럼 화면을 처음 그릴 때 필요한 것만 다룬다.
@Controller('v1/chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly jwt: JwtService,
    private readonly gateway: ChatGateway,
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

  // 상대 차단 / 해제 — 차단은 둘 중 누구나, 해제는 차단한 쪽만
  @Post('rooms/:id/block')
  async block(@Headers('authorization') auth: string, @Param('id') id: string) {
    const res = await this.chat.blockRoom(Number(id), userIdFromToken(this.jwt, auth));
    this.gateway.announce(Number(id), res.status, res.message);
    return res;
  }

  @Post('rooms/:id/unblock')
  async unblock(@Headers('authorization') auth: string, @Param('id') id: string) {
    const res = await this.chat.unblockRoom(Number(id), userIdFromToken(this.jwt, auth));
    this.gateway.announce(Number(id), res.status, (res as { message?: unknown }).message);
    return res;
  }

  // 거래완료 — 판매자만. 매물이 판매완료로 내려가고 같은 매물의 다른 대화도 닫힌다
  @Post('rooms/:id/complete')
  async complete(@Headers('authorization') auth: string, @Param('id') id: string) {
    const res = await this.chat.completeTrade(Number(id), userIdFromToken(this.jwt, auth));
    this.gateway.announce(Number(id), res.status, res.message);
    return res;
  }

  // 방을 열어두고 있으면 웹소켓이 읽음 처리를 하지만, 새로고침 등으로 들어올 땐 여기로 한 번 찍는다
  @Post('rooms/:id/read')
  async markRead(@Headers('authorization') auth: string, @Param('id') id: string) {
    await this.chat.markRead(Number(id), userIdFromToken(this.jwt, auth));
    return { ok: true };
  }
}
