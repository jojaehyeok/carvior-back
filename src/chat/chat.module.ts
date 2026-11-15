import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ChatRoom } from './entities/chat-room.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { StoreItem } from '../store-items/entities/store-item.entity';
import { User } from '../users/entities/user.entity';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatRoom, ChatMessage, StoreItem, User]),
    // 로그인 때 발급한 토큰과 같은 비밀키로 검증해야 한다(users.module과 동일 설정)
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
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}
