import { Controller, Post, Body, Get, Query, Patch, Param, UseGuards, UseInterceptors, UploadedFile, Headers } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UsersService } from './users.service';
import { S3Service } from '../s3/s3.service';
import { InternalKeyGuard } from '../store-items/internal-key.guard';
import { JwtService } from '@nestjs/jwt';
import { PhoneVerificationService } from './phone-verification.service';
import { userIdFromToken } from '../chat/chat-auth';
import { BUILD_MARK } from '../build-info';

@Controller('v1/users')
export class UsersController {
  constructor(
    private readonly svc: UsersService,
    private readonly s3: S3Service,
    private readonly jwt: JwtService,
    private readonly phoneVerification: PhoneVerificationService,
  ) {}

  @Post('upload-doc')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadDoc(@UploadedFile() file: Express.Multer.File) {
    const ext = file.originalname.split('.').pop();
    const key = `dealer-docs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const url = await this.s3.uploadFile(file, key);
    return { url };
  }

  @Post('upload-logo')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadLogo(@UploadedFile() file: Express.Multer.File) {
    const ext = file.originalname.split('.').pop();
    const key = `company-logos/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const url = await this.s3.uploadFile(file, key);
    return { url };
  }

  @Post('register')
  register(@Body() body: {
    email: string; password: string; name: string; phone?: string; role?: string; company?: string; logoUrl?: string;
    isExportOnly?: boolean; canConfirmBilling?: boolean; isPurchaseTeam?: boolean;
    dealerLicenseUrl?: string; businessRegUrl?: string; businessNumber?: string; companyName?: string;
    marketingConsent?: boolean;
  }) {
    return this.svc.register(body);
  }

  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.svc.login(body.email, body.password);
  }

  @Post('social')
  findOrCreate(@Body() body: { provider: string; providerId: string; email?: string; name?: string; profileImage?: string }) {
    return this.svc.findOrCreateSocial(body);
  }

  // 로그인된 웹 세션에 채팅용 토큰을 다시 실어주기 위한 내부 경로 — 비밀번호를 안 받으므로
  // 반드시 내부키로 막는다(웹 서버에서만 호출한다).
  //
  // 세 가지로 차례대로 찾는다. 하나만 보고 끝내면 안 된다:
  //  1) userId     — 정상적인 경우
  //  2) provider+providerId — 예전에 로그인해둔 소셜 세션은 userId 자리에 카카오/네이버
  //     계정번호가 들어있어서 1)이 실패한다. 재로그인 없이 여기서 되찾는다.
  //  3) email      — 이메일 가입 계정의 마지막 보루
  @Post('issue-token')
  @UseGuards(InternalKeyGuard)
  async issueToken(
    @Body() body: { email?: string; userId?: number | string; provider?: string; providerId?: string },
  ) {
    const tried: string[] = [];
    let found: { token: string; userId: number } | null = null;
    if (body?.userId) {
      tried.push('userId');
      found = await this.svc.issueTokenForUserId(Number(body.userId));
    }
    if (!found && body?.providerId) {
      tried.push('social');
      found = await this.svc.issueTokenForSocial(body.provider, String(body.providerId));
    }
    if (!found && body?.email) {
      tried.push('email');
      found = await this.svc.issueTokenForEmail(body.email);
    }

    if (found?.token) return found;

    // ⚠ 계정은 찾았는데 토큰이 빈 문자열인 경우 — JWT 서명이 실패한 것이다.
    // issueToken()이 예외를 삼키고 ''을 돌려주기 때문에(로그인까지 죽는 걸 막으려고),
    // 부르는 쪽에서는 "계정 없음"과 구분이 안 됐다. 2026-11-16에 이것 때문에
    // 서버 .env의 JWT_SECRET이 빠진 걸 며칠 동안 못 찾았다. 반드시 구분해서 돌려준다.
    if (found) {
      return {
        token: null,
        tokenError: 'jwt-sign-failed',
        hint: '서버 .env의 JWT_SECRET을 확인하세요',
        userId: found.userId,
        tried,
        build: BUILD_MARK,
      };
    }

    // null을 그대로 돌려주면 본문이 비어서, 부르는 쪽은 "왜 못 찾았는지"를 알 수 없다.
    return { token: null, notFound: true, tried, build: BUILD_MARK };
  }

  // 배포 확인용 — 이 서버에 어떤 코드가 올라가 있는지 밖에서 볼 수 있게.
  // ⚠ @Get(':id') 류보다 위에 있어야 한다(지금은 없지만 나중에 생기면 가려진다).
  @Get('build-mark')
  buildMark() {
    // jwtSecret은 있고 없음만 돌려준다 — 값은 절대 내보내지 않는다.
    // 이게 false면 발급되는 토큰이 전부 빈 문자열이라 채팅·앱 인증이 통째로 죽는다.
    return { build: BUILD_MARK, jwtSecret: !!process.env.JWT_SECRET };
  }

  // ── 휴대폰 번호 인증 ──────────────────────────────────────────────
  // 가입 번호와 다른 번호로 접수한 검차 건을 내 계정에 붙이기 위한 것.
  // ⚠ 반드시 로그인 토큰으로 본인을 확인한다 — 인증 없이 번호만 받으면
  // 남의 번호를 넣어 남의 검차 이력을 들여다볼 수 있다.
  @Post('phone-verify/send')
  sendPhoneCode(@Headers('authorization') auth: string, @Body('phone') phone: string) {
    userIdFromToken(this.jwt, auth); // 로그인한 사람만
    return this.phoneVerification.send(phone);
  }

  @Post('phone-verify/confirm')
  confirmPhoneCode(
    @Headers('authorization') auth: string,
    @Body() body: { phone: string; code: string },
  ) {
    const userId = userIdFromToken(this.jwt, auth);
    return this.phoneVerification.confirm(userId, body?.phone, body?.code);
  }

  /**
   * 소셜로 들어온 분에게 한 번 받는 자리 — 번호(문자 인증)와 이메일.
   *
   * 번호가 없으면 마이페이지에서 자기 검차 신청을 못 본다(bookings 는 번호로 찾는다).
   * 이메일이 없으면 연락도 비밀번호 되찾기도 못 한다. 둘 다 비어 있을 때만 채운다.
   *
   * ⚠ 반드시 로그인 토큰으로 본인을 확인한다 — 인증 없이 받으면 남의 계정에
   * 내 번호를 붙여 남의 검차 이력을 들여다볼 수 있다.
   */
  @Post('profile/complete')
  async completeProfile(
    @Headers('authorization') auth: string,
    @Body() body: { phone: string; code: string; email?: string; name?: string; marketingConsent?: boolean },
  ) {
    const userId = userIdFromToken(this.jwt, auth);
    const verified = await this.phoneVerification.confirmPrimary(userId, body?.phone, body?.code);
    const saved = await this.svc.completeProfile(userId, {
      email: body?.email,
      name: body?.name,
      marketingConsent: body?.marketingConsent,
    });
    return { ...saved, phone: verified.phone, primary: verified.primary };
  }

  // 내가 본인 것으로 확인한 번호 전부(가입 번호 + 인증한 추가 번호)
  @Get('my-phones')
  async myPhones(@Headers('authorization') auth: string) {
    const userId = userIdFromToken(this.jwt, auth);
    return { phones: await this.phoneVerification.phonesForUser(userId) };
  }

  @Get('by-email')
  findByEmail(@Query('email') email: string) {
    return this.svc.findByEmail(email);
  }

  // ⚠ 전 회원 명단이다. 내부키 없이 열어두면 이메일·전화번호가 그대로 새어나간다.
  // (2026-11-16 확인: 웹·대시보드·앱 어디에서도 부르지 않는다)
  @Get()
  @UseGuards(InternalKeyGuard)
  findAll() {
    return this.svc.findAll();
  }

  @Patch(':id/role')
  @UseGuards(InternalKeyGuard)
  updateRole(@Param('id') id: string, @Body() body: { role: string }) {
    return this.svc.updateRole(Number(id), body.role);
  }

  @Get('dealers')
  findDealers() {
    return this.svc.findDealers();
  }

  @Patch(':id/dealer-status')
  @UseGuards(InternalKeyGuard)
  updateDealerStatus(@Param('id') id: string, @Body() body: { dealerStatus: string }) {
    return this.svc.updateDealerStatus(Number(id), body.dealerStatus);
  }

  @Patch(':id/apply-dealer')
  @UseGuards(InternalKeyGuard)
  applyDealer(@Param('id') id: string, @Body() body: {
    dealerLicenseUrl: string; businessRegUrl?: string; businessNumber?: string; companyName?: string;
  }) {
    return this.svc.applyDealer(Number(id), body);
  }

  @Patch(':id/password')
  async updatePassword(@Param('id') id: string, @Body() body: { password: string }) {
    await this.svc.updatePassword(Number(id), body.password);
    return { success: true };
  }

  @Patch(':id/admin-info')
  updateAdminInfo(@Param('id') id: string, @Body() body: { name?: string; phone?: string; company?: string; logoUrl?: string; profileImage?: string; isExportOnly?: boolean }) {
    return this.svc.updateAdminInfo(Number(id), body);
  }

  @Patch(':id/push-token')
  async savePushToken(@Param('id') id: string, @Body('pushToken') pushToken: string) {
    await this.svc.updatePushToken(Number(id), pushToken);
    return { success: true };
  }

  // 관리자 대시보드에서 브라우저 알림 권한을 허용하면 받은 FCM 토큰을 여기로 저장한다.
  // 로그인한 본인 계정에만 저장하므로 별도 권한 가드는 두지 않는다(기존 push-token과 동일).
  // 슈퍼관리자 전용 — 대시보드 하드코딩 계정이라 :id가 숫자가 아니어서 아래 경로를 못 쓴다.
  // 반드시 ':id/web-push-token'보다 위에 있어야 'super-admin'이 :id로 잡히지 않는다.
  @Patch('super-admin/web-push-token')
  async saveSuperAdminWebPushToken(@Body('webPushToken') webPushToken: string) {
    await this.svc.updateSuperAdminWebPushToken(webPushToken);
    return { success: true };
  }

  @Patch(':id/web-push-token')
  async saveWebPushToken(@Param('id') id: string, @Body('webPushToken') webPushToken: string) {
    await this.svc.updateWebPushToken(Number(id), webPushToken);
    return { success: true };
  }

  @Patch(':id/marketing-consent')
  updateMarketingConsent(@Param('id') id: string, @Body() body: { marketingConsent: boolean }) {
    return this.svc.updateMarketingConsent(Number(id), !!body.marketingConsent);
  }

  @Get('admins')
  findAdmins() {
    return this.svc.findAdmins();
  }
}
