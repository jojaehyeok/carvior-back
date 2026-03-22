import { Controller, Post, Body, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { DriversService } from '../drivers/drivers.service';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly driversService: DriversService) {}

  @Post('login')
  async login(@Body() loginDto: any) {
    const { accountId, password } = loginDto;
    
    // 1. 아이디로 진단사 정보 조회
    const driver = await this.driversService.findByAccountId(accountId);
    
    // 2. 계정이 없거나 비밀번호가 틀린 경우
    if (!driver || driver.password !== password) {
      throw new UnauthorizedException('아이디 또는 비밀번호를 잘못 입력했습니다.');
    }

    // 3. 승인 상태 체크 (Step 3 핵심 로직)
    if (driver.status === 'PENDING') {
      throw new ForbiddenException('현재 가입 승인 대기 중입니다. 관리자 승인 후 로그인이 가능합니다.');
    }

    if (driver.status === 'REJECTED') {
      throw new ForbiddenException('가입 신청이 거절되었습니다. 사유는 고객센터로 문의주세요.');
    }

    // 4. 모든 검증 통과 시 성공 응답
    return {
      success: true,
      driverId: driver.id,
      name: driver.name,
      status: driver.status,
    };
  }
}