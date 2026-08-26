import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

// /partner-api/oauth/token에서 발급한 Bearer 토큰만 통과시킴 (internal-key.guard.ts의
// 고정 헤더키 방식과 달리, 만료시간이 있는 진짜 OAuth2.0 access token 검증)
@Injectable()
export class PartnerOAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const authHeader: string | undefined = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token) {
      throw new UnauthorizedException({ error: 'invalid_token', error_description: 'Bearer 토큰이 필요합니다.' });
    }
    try {
      req.partnerClient = this.jwt.verify(token);
      return true;
    } catch (e) {
      throw new UnauthorizedException({ error: 'invalid_token', error_description: '토큰이 유효하지 않거나 만료되었습니다.' });
    }
  }
}
