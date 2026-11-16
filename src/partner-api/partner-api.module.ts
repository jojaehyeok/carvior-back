import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Booking } from '../bookings/entities/booking.entity';
import { Inspection } from '../inspection/entities/inspection.entity';
import { BookingsModule } from '../bookings/bookings.module';
import { User } from '../users/entities/user.entity';
import { PartnerClient } from './entities/partner-client.entity';
import { PartnerApiController } from './partner-api.controller';
import { PartnerAdminController } from './partner-admin.controller';
import { PartnerOAuthGuard } from './partner-oauth.guard';

@Module({
  imports: [
    // User는 온보딩 점검용 — 발주사 계정(role=admin, company=코드)이 있는지만 본다.
    TypeOrmModule.forFeature([Booking, Inspection, PartnerClient, User]),
    // 검차 주문은 bookingsService.create()를 그대로 쓴다 — 자동배정·평가사 알림·좌표·
    // 묶음·관리자 알림톡이 전부 거기 들어 있다. 여기서 따로 접수 로직을 쓰면 두 경로가
    // 갈라져서, 한쪽만 고쳐지는 일이 반드시 생긴다.
    BookingsModule,
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
  // 운영자용 admin 경로를 먼저 등록한다 — ':partner/...' 패턴이 'admin/...'을 먹지
  // 않도록(현재 두 번째 세그먼트가 서로 달라 겹치지 않지만, 경로가 늘면 겹친다).
  controllers: [PartnerAdminController, PartnerApiController],
  providers: [PartnerOAuthGuard],
})
export class PartnerApiModule {}
