import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PartnerApplication } from './entities/partner-application.entity';
import { SolapiService } from '../solapi/solapi.service';

@Injectable()
export class PartnerApplicationsService {
  constructor(
    @InjectRepository(PartnerApplication)
    private readonly repo: Repository<PartnerApplication>,
    private readonly solapiService: SolapiService,
  ) {}

  findAll(): Promise<PartnerApplication[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  // 마이페이지에서 로그인 유저(전화번호 기준)가 이미 신청했는지/승인됐는지 확인하는 공개 조회용.
  // 같은 번호로 여러 번 신청했을 수 있어 가장 최근 것만 반환.
  findLatestByPhone(phone: string): Promise<PartnerApplication | null> {
    const clean = phone.replace(/[^0-9]/g, '');
    return this.repo.findOne({ where: { phone: clean }, order: { createdAt: 'DESC' } });
  }

  async create(data: { name: string; phone: string; email?: string; companyName?: string; message?: string; qualifyingCount: number }): Promise<PartnerApplication> {
    const app = this.repo.create(data);
    const saved = await this.repo.save(app);

    try {
      await this.solapiService.sendSms('01022856017', `[카비어] 파트너패널 제휴신청: ${data.name}(${data.phone}) 개별건 ${data.qualifyingCount}회`);
    } catch { /* 알림 실패해도 신청 저장은 정상 처리 */ }

    return saved;
  }

  async updateStatus(id: number, status: 'pending' | 'approved' | 'rejected'): Promise<PartnerApplication> {
    const app = await this.repo.findOneBy({ id });
    if (!app) throw new NotFoundException('신청 내역을 찾을 수 없습니다.');
    app.status = status;
    return this.repo.save(app);
  }
}
