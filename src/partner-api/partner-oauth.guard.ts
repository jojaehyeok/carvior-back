import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface PartnerTokenPayload {
  /** 상사 코드 — PartnerClient.code */
  sub: string;
  /** 쉼표로 구분한 권한 */
  scope: string;
}

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

    let payload: PartnerTokenPayload;
    try {
      payload = this.jwt.verify<PartnerTokenPayload>(token);
    } catch {
      throw new UnauthorizedException({ error: 'invalid_token', error_description: '토큰이 유효하지 않거나 만료되었습니다.' });
    }
    req.partnerClient = payload;

    // ⚠ 경로를 :partner로 일반화하면서 반드시 같이 있어야 하는 검사다.
    // 이게 없으면 상사 A가 자기 토큰으로 /partner-api/{상사B}/inspections 를 불러
    // 남의 상사 접수 내역(차주 연락처·주소·매입가)을 그대로 읽을 수 있다.
    // 토큰의 주인(sub)과 경로가 가리키는 상사가 같을 때만 통과시킨다.
    const requested: string | undefined = req.params?.partner;
    if (requested && payload.sub !== requested) {
      throw new ForbiddenException({
        error: 'insufficient_scope',
        error_description: `이 토큰으로는 ${requested} 자료를 조회할 수 없습니다.`,
      });
    }

    return true;
  }
}

/**
 * 토큰에 특정 권한이 실려 있는지 확인한다.
 *
 * 가드에서 한 번에 처리하지 않는 이유는 엔드포인트마다 필요한 권한이 다르기 때문이다 —
 * 데코레이터로 메타데이터를 읽는 방식(Reflector)은 이 모듈에 엔드포인트가 세 개뿐인
 * 지금 단계에서는 과하다. 엔드포인트가 늘면 그때 커스텀 데코레이터로 옮긴다.
 */
export function assertScope(payload: PartnerTokenPayload | undefined, needed: string): void {
  const granted = (payload?.scope ?? '').split(',').map((s) => s.trim());
  if (!granted.includes(needed)) {
    throw new ForbiddenException({
      error: 'insufficient_scope',
      error_description: `이 작업에는 ${needed} 권한이 필요합니다. 카비어 담당자에게 문의하세요.`,
    });
  }
}
