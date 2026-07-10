import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { StoreItem } from './entities/store-item.entity';

@Injectable()
export class StoreItemsService {
  constructor(
    @InjectRepository(StoreItem)
    private readonly repo: Repository<StoreItem>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findAll(): Promise<any[]> {
    return this.dataSource.query(`
      SELECT si.*, i.carHash
      FROM store_items si
      LEFT JOIN inspections i ON i.bookingId = si.bookingId
      ORDER BY si.registeredAt DESC
    `);
  }

  async findByUser(userId: number): Promise<StoreItem[]> {
    return this.repo.find({ where: { userId }, order: { registeredAt: 'DESC' } });
  }

  async create(data: Partial<StoreItem>): Promise<StoreItem> {
    if (data.carNumber) {
      const exists = await this.repo.findOne({ where: { carNumber: data.carNumber } });
      if (exists) throw new ConflictException('이미 등록된 차량번호입니다.');
    }
    const item = this.repo.create({ ...data, status: 'pending' });
    return this.repo.save(item);
  }

  async update(id: number, data: Partial<StoreItem>): Promise<StoreItem> {
    const item = await this.repo.findOneBy({ id });
    if (!item) throw new NotFoundException(`스토어 아이템 ${id}를 찾을 수 없습니다.`);
    Object.assign(item, data);
    return this.repo.save(item);
  }

  async remove(id: number): Promise<void> {
    const item = await this.repo.findOneBy({ id });
    if (!item) throw new NotFoundException(`스토어 아이템 ${id}를 찾을 수 없습니다.`);
    await this.repo.remove(item);
  }
}
