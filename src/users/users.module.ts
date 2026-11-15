import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { JwtModule } from '@nestjs/jwt';
import { memoryStorage } from 'multer';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { S3Service } from '../s3/s3.service';
import { SolapiService } from '../solapi/solapi.service';
import { PhoneVerificationService } from './phone-verification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    MulterModule.register({ storage: memoryStorage() }),
    // 고객용 네이티브 앱 로그인용 토큰 발급(웹은 계속 NextAuth 자체 세션을 씀, 이 토큰은 앱 전용)
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
  controllers: [UsersController],
  providers: [UsersService, S3Service, SolapiService, PhoneVerificationService],
  exports: [UsersService, PhoneVerificationService],
})
export class UsersModule {}
