import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { userIdFromToken } from './chat-auth';

/**
 * 채팅 실시간 처리.
 *
 * 접속할 때 토큰을 한 번 검증해서 socket에 userId를 붙여두고, 이후 모든 이벤트는 그 값을 쓴다
 * (클라이언트가 보내는 userId는 믿지 않는다).
 *
 * ⚠ 운영: 앞단 Apache에 mod_proxy_wstunnel 설정이 없으면 웹소켓 업그레이드가 막힌다.
 * 그 경우 socket.io가 알아서 long-polling으로 내려가 동작은 하지만 반응이 조금 느려진다.
 */
@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: true, credentials: true },
})
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chat: ChatService,
    private readonly jwt: JwtService,
  ) {}

  handleConnection(socket: Socket) {
    try {
      const token = (socket.handshake.auth?.token as string) ?? socket.handshake.headers.authorization;
      socket.data.userId = userIdFromToken(this.jwt, token);
    } catch {
      // 토큰이 없거나 만료 — 조용히 끊는다(에러를 던지면 서버 로그만 지저분해진다)
      socket.emit('unauthorized');
      socket.disconnect(true);
    }
  }

  // 방에 들어가기 — 참여자인지 확인한 뒤에만 방 채널에 넣는다
  @SubscribeMessage('join')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() body: { roomId: number }) {
    const userId = socket.data.userId as number;
    await this.chat.getRoom(Number(body.roomId), userId); // 권한 없으면 여기서 예외
    socket.join(`room:${body.roomId}`);
    await this.chat.markRead(Number(body.roomId), userId);
    return { ok: true };
  }

  @SubscribeMessage('leave')
  leave(@ConnectedSocket() socket: Socket, @MessageBody() body: { roomId: number }) {
    socket.leave(`room:${body.roomId}`);
    return { ok: true };
  }

  @SubscribeMessage('send')
  async send(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { roomId: number; text: string; type?: 'text' | 'inspection' },
  ) {
    const userId = socket.data.userId as number;
    const saved = await this.chat.sendMessage(Number(body.roomId), userId, body.text, body.type ?? 'text');
    // 보낸 사람 화면에도 같은 경로로 뿌려서 내 말과 상대 말이 같은 모양으로 쌓이게 한다
    this.server.to(`room:${body.roomId}`).emit('message', saved);
    return saved;
  }

  /**
   * REST(차단·거래완료)에서 바뀐 상태를 방에 열려 있는 화면들에 알린다.
   * 이게 없으면 상대는 새로고침할 때까지 차단된 걸 모르고 계속 입력한다.
   */
  announce(roomId: number, status: string, message?: unknown) {
    if (message) this.server?.to(`room:${roomId}`).emit('message', message);
    this.server?.to(`room:${roomId}`).emit('room', { roomId, status });
  }

  @SubscribeMessage('read')
  async read(@ConnectedSocket() socket: Socket, @MessageBody() body: { roomId: number }) {
    await this.chat.markRead(Number(body.roomId), socket.data.userId as number);
    return { ok: true };
  }
}
