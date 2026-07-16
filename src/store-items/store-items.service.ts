import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { StoreItem } from './entities/store-item.entity';
import { computeAuctionEndAt } from './auction-time.util';

// 진단완료(firstCompletedAt) 후 이 시간이 지나야 스마트옥션에 자동 게시됨
// (그 사이 진단사 수정 2h, 매니저 검토 2h 구간)
const AUTO_PUBLISH_DELAY_MS = 4 * 60 * 60 * 1000;

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
      SELECT si.*, i.carHash, i.firstCompletedAt,
        CASE WHEN i.carHash IS NOT NULL THEN 1 ELSE 0 END AS hasReport
      FROM store_items si
      LEFT JOIN inspections i ON i.bookingId = si.bookingId
      ORDER BY
        CASE WHEN i.carHash IS NOT NULL THEN 0 ELSE 1 END,
        si.registeredAt DESC
    `);

    const now = new Date();

    // 진단완료 후 4시간(수정 2h + 매니저 검토 2h) 지난 pending 매물 → 자동 게시
    const toActivate = rows.filter((r: any) => {
      if (r.status !== 'pending' || !r.carHash || !r.firstCompletedAt) return false;
      return now.getTime() - new Date(r.firstCompletedAt).getTime() >= AUTO_PUBLISH_DELAY_MS;
    });
    for (const r of toActivate) {
      const auctionEndAt = computeAuctionEndAt(now);
      await this.dataSource.query(
        `UPDATE store_items SET status = 'active', auctionStartAt = ?, auctionEndAt = ? WHERE id = ?`,
        [now, auctionEndAt, r.id],
      );
      r.status = 'active';
      r.auctionStartAt = now;
      r.auctionEndAt = auctionEndAt;
    }

    // 마감시각이 지난 경매는 자동 마감 (낙찰 처리는 별도로 어드민이 확인)
    const toClose = rows.filter((r: any) =>
      r.status === 'active' && r.auctionEndAt && new Date(r.auctionEndAt).getTime() < now.getTime(),
    );
    if (toClose.length > 0) {
      const ids = toClose.map((r: any) => r.id);
      await this.dataSource.query(
        `UPDATE store_items SET status = 'closed' WHERE id IN (${ids.join(',')})`,
      );
      rows.forEach((r: any) => { if (ids.includes(r.id)) r.status = 'closed'; });
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
