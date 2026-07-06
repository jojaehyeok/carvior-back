import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Proposal } from './proposal.entity';

@Injectable()
export class ProposalsService {
  constructor(
    @InjectRepository(Proposal)
    private readonly repo: Repository<Proposal>,
  ) {}

  async create(data: Partial<Proposal>): Promise<Proposal> {
    return this.repo.save(this.repo.create(data));
  }

  async findByItem(storeItemId: string): Promise<Proposal[]> {
    return this.repo.find({
      where: { storeItemId },
      order: { createdAt: 'DESC' },
    });
  }

  async countByItem(storeItemId: string): Promise<number> {
    return this.repo.count({ where: { storeItemId } });
  }

  async findAll(): Promise<Proposal[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }
}
