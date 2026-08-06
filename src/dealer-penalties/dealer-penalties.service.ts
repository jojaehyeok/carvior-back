import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { DealerPenalty } from './dealer-penalty.entity';

@Injectable()
export class DealerPenaltiesService {
  constructor(
    @InjectRepository(DealerPenalty)
    private readonly repo: Repository<DealerPenalty>,
  ) {}

  async existsForItem(storeItemId: number): Promise<boolean> {
    const count = await this.repo.count({ where: { storeItemId } });
    return count > 0;
  }

  async isPenalized(dealerId: number): Promise<boolean> {
    const count = await this.repo.count({
      where: { dealerId, expiresAt: MoreThanOrEqual(new Date()) },
    });
    return count > 0;
  }

  async countTodayBids(dealerId: number, bidRepo: Repository<any>): Promise<number> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return bidRepo.count({
      where: { dealerId, createdAt: MoreThanOrEqual(todayStart) },
    });
  }

  async listActive(dealerId: number): Promise<DealerPenalty[]> {
    return this.repo.find({
      where: { dealerId, expiresAt: MoreThanOrEqual(new Date()) },
      order: { createdAt: 'DESC' },
    });
  }

  async create(dealerId: number, reason: string, days: number, storeItemId?: number, note?: string): Promise<DealerPenalty> {
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const penalty = this.repo.create({ dealerId, reason, expiresAt, storeItemId, note });
    return this.repo.save(penalty);
  }
}
