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
    const rows = await this.dataSource.query(`
      SELECT si.*, i.carHash,
        CASE WHEN i.carHash IS NOT NULL THEN 1 ELSE 0 END AS hasReport
      FROM store_items si
      LEFT JOIN inspections i ON i.bookingId = si.bookingId
      ORDER BY
        CASE WHEN i.carHash IS NOT NULL THEN 0 ELSE 1 END,
        si.registeredAt DESC
    `);

    // 검차 완료된 매물은 pending → active 자동 전환
    const toActivate = rows.filter((r: any) => r.carHash && r.status === 'pending');
    if (toActivate.length > 0) {
      const ids = toActivate.map((r: any) => r.id);
      await this.dataSource.query(
        `UPDATE store_items SET status = 'active' WHERE id IN (${ids.join(',')})`,
      );
      rows.forEach((r: any) => { if (ids.includes(r.id)) r.status = 'active'; });
    }

    return rows;
  }

  async findByUser(userId: number): Promise<StoreItem[]> {
    return this.repo.find({ where: { userId }, order: { registeredAt: 'DESC' } });
  }

  async findOne(id: number): Promise<StoreItem> {
    const item = await this.repo.findOneBy({ id });
    if (!item) throw new NotFoundException(`스토어 아이템 ${id}를 찾을 수 없습니다.`);
    return item;
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

  async getStats(id: number): Promise<{ views: number; likes: number }> {
    const row = await this.repo.findOne({ where: { id }, select: ['views', 'likes'] });
    return { views: row?.views ?? 0, likes: row?.likes ?? 0 };
  }

  async updateStats(id: number, action: string): Promise<{ views: number; likes: number }> {
    if (action === 'view') {
      await this.dataSource.query('UPDATE store_items SET views = views + 1 WHERE id = ?', [id]);
    } else if (action === 'like') {
      await this.dataSource.query('UPDATE store_items SET likes = likes + 1 WHERE id = ?', [id]);
    } else if (action === 'unlike') {
      await this.dataSource.query('UPDATE store_items SET likes = GREATEST(0, likes - 1) WHERE id = ?', [id]);
    }
    return this.getStats(id);
  }
}
