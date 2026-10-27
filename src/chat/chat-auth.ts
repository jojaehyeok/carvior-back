import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';

/**
 * 채팅은 남의 대화를 보면 안 되는 기능이라, 클라이언트가 보내주는 userId를 믿으면 안 된다.
 * 로그인할 때 서버가 발급한 JWT(users.service의 issueToken, sub=userId)를 검증해서 쓴다.
 *
 * 웹(cavior)은 NextAuth 세션에 이 토큰을 실어두고, REST는 Authorization 헤더로,
 * 웹소켓은 접속할 때 auth.token으로 넘긴다.
 */
export function userIdFromToken(jwt: JwtService, raw?: string): number {
  const token = (raw ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new UnauthorizedException('로그인이 필요합니다.');
  try {
    const payload = jwt.verify<{ sub: number }>(token);
    if (!payload?.sub) throw new Error('sub 없음');
    return Number(payload.sub);
  } catch {
    throw new UnauthorizedException('로그인 정보가 만료되었습니다. 다시 로그인해주세요.');
  }
}
