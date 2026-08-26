import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Booking } from '../bookings/entities/booking.entity';
import { Inspection } from '../inspection/entities/inspection.entity';
import { PartnerApiController } from './partner-api.controller';
import { PartnerOAuthGuard } from './partner-oauth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Inspection]),
    // 발주사 파트너 OAuth2.0 access token 전용 시크릿 — 고객앱 로그인 토큰(users.module.ts의
    // JWT_SECRET)과 분리해서, 한쪽이 유출돼도 다른 쪽엔 영향 없게 함.
    // registerAsync + useFactory를 써야 함: register()로 쓰면 이 옵션 객체가 파일 import
    // 시점(ConfigModule.forRoot()가 .env를 로드하기 전)에 평가돼서 process.env.PARTNER_OAUTH_SECRET이
    // 항상 undefined로 굳어버림(로컬 재현: "secretOrPrivateKey must have a value" 에러) —
    // registerAsync는 Nest가 실제 DI 인스턴스화할 때 팩토리를 호출해서 이 문제를 피해간다.
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.PARTNER_OAUTH_SECRET,
        signOptions: { expiresIn: '1h' },
      }),
    }),
  ],
  controllers: [PartnerApiController],
  providers: [PartnerOAuthGuard],
})
export class PartnerApiModule {}
