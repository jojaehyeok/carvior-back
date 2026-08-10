import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SettlementExtraCost } from './entities/settlement-extra-cost.entity';

@Injectable()
export class SettlementExtraCostService {
  constructor(
    @InjectRepository(SettlementExtraCost)
    private readonly repo: Repository<SettlementExtraCost>,
  ) {}

  async get(source: string, month: string): Promise<number> {
    const row = await this.repo.findOne({ where: { source, month } });
    return row ? Number(row.amount) : 0;
  }

  async set(source: string, month: string, amount: number): Promise<SettlementExtraCost> {
    let row = await this.repo.findOne({ where: { source, month } });
    if (!row) row = this.repo.create({ source, month });
    row.amount = amount;
    return this.repo.save(row);
  }
}
