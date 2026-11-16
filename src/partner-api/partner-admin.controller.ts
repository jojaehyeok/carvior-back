import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PartnerClient } from './entities/partner-client.entity';
import { User } from '../users/entities/user.entity';
import { InternalKeyGuard } from '../store-items/internal-key.guard';

/**
 * 상사 온보딩 — 파트너 API 열쇠 발급.
 *
 * 상사 통합관리 프로그램 가입 흐름이 생기면 그쪽에서 이걸 부른다. 그때까지는
 * 운영자가 x-internal-key를 들고 직접 부른다(.env의 STORE_ITEMS_INTERNAL_KEY).
 *
 * ⚠ 여기서 발급하는 건 "API 열쇠"뿐이다. 검차가 실제로 평가사에게 배정되려면
 * carvior 쪽 **발주사 계정**(User role=admin, company={코드})도 있어야 한다 —
 * bookings.service.ts의 isRestrictedSource()가 그걸로 등록 발주사를 판정하기 때문이다.
 * 그 계정은 대시보드 "관리자 계정 관리"에서 만든다. 여기서는 있는지 없는지만 알려준다.
 */
@Controller('v1/partner-api/admin')
@UseGuards(InternalKeyGuard)
export class PartnerAdminController {
  constructor(
    @InjectRepository(PartnerClient)
    private readonly partnerRepository: Repository<PartnerClient>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * 열쇠 발급. 평문 시크릿은 **이 응답에서 한 번만** 나온다 — DB에는 해시만 남아서
   * 다시 꺼낼 수 없다. 잃어버리면 재발급(POST .../rotate)해야 한다.
   */
  @Post('clients')
  async create(@Body() body: { code?: string; name?: string; scopes?: string }) {
    const code = body.code?.trim();
    const name = body.name?.trim();
    if (!code || !name) {
      throw new BadRequestException('code(상사 코드)와 name(상사 이름)이 필요합니다.');
    }
    // 코드는 booking.source와 서브도메인에 그대로 들어간다. 대문자·공백·한글이 섞이면
    // 한쪽에서만 normalize되면서 조회가 빈손으로 돌아온다 — 아예 받지 않는다.
    if (!/^[a-z0-9-]{2,40}$/.test(code)) {
      throw new BadRequestException('code는 영소문자·숫자·하이픈 2~40자여야 합니다. (예: anyone-motors)');
    }
    if (await this.partnerRepository.findOne({ where: { code } })) {
      throw new ConflictException(`이미 발급된 상사 코드입니다: ${code}`);
    }

    const clientId = `cv_${code}_${randomBytes(6).toString('hex')}`;
    const clientSecret = randomBytes(24).toString('base64url');
    const partner = await this.partnerRepository.save(
      this.partnerRepository.create({
        code,
        name,
        clientId,
        clientSecretHash: await bcrypt.hash(clientSecret, 10),
        ...(body.scopes?.trim() ? { scopes: body.scopes.trim() } : {}),
      }),
    );

    return {
      code: partner.code,
      name: partner.name,
      clientId,
      // 다시 볼 수 없는 값이다. 상사에게 전달한 뒤 이 응답은 지울 것.
      clientSecret,
      scopes: partner.scopes,
      ...(await this.partnerSetupHint(code)),
    };
  }

  /** 시크릿 재발급 — 잃어버렸거나 샜을 때. 기존 시크릿은 즉시 무효가 된다. */
  @Post('clients/:code/rotate')
  async rotate(@Param('code') code: string) {
    const partner = await this.partnerRepository.findOne({ where: { code } });
    if (!partner) throw new NotFoundException(`등록되지 않은 상사 코드입니다: ${code}`);

    const clientSecret = randomBytes(24).toString('base64url');
    partner.clientSecretHash = await bcrypt.hash(clientSecret, 10);
    await this.partnerRepository.save(partner);
    return { code: partner.code, clientId: partner.clientId, clientSecret };
  }

  /** 중지·재개. 레코드를 지우지 않는다 — 지우면 그 상사가 넣은 접수의 출처 추적이 끊긴다. */
  @Patch('clients/:code')
  async setActive(@Param('code') code: string, @Body() body: { active?: boolean }) {
    const partner = await this.partnerRepository.findOne({ where: { code } });
    if (!partner) throw new NotFoundException(`등록되지 않은 상사 코드입니다: ${code}`);
    if (typeof body.active !== 'boolean') throw new BadRequestException('active(true/false)가 필요합니다.');

    partner.active = body.active;
    await this.partnerRepository.save(partner);
    return { code: partner.code, active: partner.active };
  }

  /** 발급된 상사 목록. 시크릿 해시는 내려보내지 않는다. */
  @Get('clients')
  async list() {
    const partners = await this.partnerRepository.find({ order: { id: 'ASC' } });
    const data = await Promise.all(
      partners.map(async (p) => ({
        code: p.code,
        name: p.name,
        clientId: p.clientId,
        scopes: p.scopes,
        active: p.active,
        createdAt: p.createdAt,
        ...(await this.partnerSetupHint(p.code)),
      })),
    );
    return { data, count: data.length };
  }

  /**
   * 발주사 계정이 있는지 — 없으면 접수는 되지만 자동배정·평가사 알림이 전부 건너뛰어진다.
   * 온보딩에서 가장 자주 빠지는 단계라 응답마다 같이 실어 보낸다.
   */
  private async partnerSetupHint(code: string) {
    const admin = await this.userRepository.findOne({ where: { role: 'admin', company: code } });
    return {
      partnerAccountReady: !!admin,
      ...(admin
        ? {}
        : {
            hint: `대시보드 "관리자 계정 관리"에서 company=${code} 인 관리자 계정을 먼저 만들어야 합니다. 없으면 접수는 저장되지만 평가사 자동배정·알림이 되지 않습니다.`,
          }),
    };
  }
}
