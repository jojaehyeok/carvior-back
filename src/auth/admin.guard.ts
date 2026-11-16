import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * 관리자(대시보드) 전용 엔드포인트 가드.
 *
 * 왜 필요했나 — bookings 컨트롤러에는 가드가 **하나도 없었다.** 주소만 알면 누구나
 * `/v1/external/request/list?source=...`로 차주 연락처·주소·매입가를 전부 받아갈 수 있었고,
 * `PATCH :id/assign` 같은 것도 그냥 쳐서 배정을 바꿀 수 있었다.
 *
 * 토큰은 새로 만들지 않는다 — `POST /v1/users/login`이 이미 `{ sub: userId }` JWT를
 * 돌려주고 있다(users.service.ts의 issueToken). 대시보드가 그걸 세션에 담아 보내면 된다.
 * 토큰 안에 role이 없으므로 여기서 사용자를 한 번 읽어 권한을 확인한다.
 *
 * ⚠ 점진 적용 — `ADMIN_API_STRICT`가 'true'일 때만 실제로 막는다.
 *
 * 돌고 있는 대시보드에 가드를 한 번에 켜면, 토큰이 한 군데라도 안 실려 있을 때 화면이
 * 통째로 멈춘다(그걸 배포 후에 알게 된다). 그래서 기본값은 "통과시키고 경고만 남김"이다.
 * 배포하고 로그에 [admin-guard] 경고가 안 찍히는 걸 확인한 다음 env 하나로 켠다.
 * 켜기 전까지는 보호가 아니라 **계측**이라는 점을 잊지 말 것.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger('admin-guard');

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // @Public('이유')로 열어둔 엔드포인트 — 고객 신청 폼처럼 로그인 없이 쓰는 것들
    const isPublic = this.reflector.getAllAndOverride(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const path: string = req.originalUrl ?? req.url ?? '';

    const reject = (reason: string): boolean => {
      // strict가 아니면 막지 않는다. 다만 어디서 무엇이 빠졌는지는 반드시 남긴다 —
      // 이 로그가 비어 있어야 strict로 올릴 수 있다.
      if (process.env.ADMIN_API_STRICT !== 'true') {
        this.logger.warn(`${reason} — ${path} (strict 아님, 통과시킴)`);
        return true;
      }
      throw new ForbiddenException('관리자 권한이 필요합니다.');
    };

    // 내부 서버끼리 부르는 건(웹의 서버 라우트 등) 기존 내부키도 그대로 인정한다.
    // 브라우저를 거치지 않으므로 사람 토큰보다 오히려 안전하다.
    const internalKey = req.headers['x-internal-key'];
    if (internalKey && internalKey === process.env.STORE_ITEMS_INTERNAL_KEY) return true;

    const authHeader: string | undefined = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token) return reject('토큰 없음');

    let userId: number;
    try {
      const payload = this.jwt.verify<{ sub: number | string }>(token);
      userId = Number(payload?.sub);
    } catch {
      return reject('토큰 검증 실패');
    }
    if (!Number.isFinite(userId)) return reject('토큰에 사용자 번호 없음');

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) return reject(`사용자 없음(${userId})`);
    // 고객 계정도 같은 토큰을 받는다 — 대시보드 엔드포인트는 관리자만이어야 한다.
    if (user.role !== 'admin') return reject(`관리자 아님(${userId}, role=${user.role})`);

    // 발주사 계정(company 있음)인지 슈퍼관리자(company 없음)인지는 뒤에서 쓸 수 있게 실어둔다.
    req.adminUser = { id: user.id, role: user.role, company: user.company ?? null };
    return true;
  }
}
