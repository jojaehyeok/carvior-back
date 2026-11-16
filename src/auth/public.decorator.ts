import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'carvior:isPublic';

/**
 * 인증 없이 열어 두는 엔드포인트.
 *
 * AdminGuard를 컨트롤러 전체에 걸고, 진짜로 공개여야 하는 것만 이걸로 연다.
 * 반대로(엔드포인트마다 가드를 붙이는 방식) 하면 새로 추가하는 엔드포인트가 기본적으로
 * 뚫려 있게 되고, 그걸 아무도 알아채지 못한다 — bookings 컨트롤러가 실제로 그랬다.
 *
 * ⚠ 여는 이유를 반드시 한 줄로 적을 것. "왜 공개인지"가 없으면 다음 사람이 판단할 수 없다.
 */
export const Public = (reason: string) => SetMetadata(IS_PUBLIC_KEY, reason || true);
