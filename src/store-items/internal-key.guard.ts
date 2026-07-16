import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class InternalKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['x-internal-key'];
    if (!key || key !== process.env.STORE_ITEMS_INTERNAL_KEY) {
      throw new ForbiddenException('접근 권한이 없습니다.');
    }
    return true;
  }
}
