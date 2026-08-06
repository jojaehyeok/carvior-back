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
