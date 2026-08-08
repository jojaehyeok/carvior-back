import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { StoreItem } from './entities/store-item.entity';
import { computeAuctionEndAt } from './auction-time.util';
import { ComplianceService } from '../compliance/compliance.service';
import { SolapiService } from '../solapi/solapi.service';
import { BidsService } from '../bids/bids.service';

function genOwnerAccessToken(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

// 진단완료(firstCompletedAt) 후 이 시간이 지나야 스마트옥션에 자동 게시됨
// (그 사이 진단사 자체수정 2h + 진단매니저 검수·수정 4h = 총 6h, 스펙을 두 번 검수 후 게시)
const AUTO_PUBLISH_DELAY_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class StoreItemsService {
  constructor(
    @InjectRepository(StoreItem)
    private readonly repo: Repository<StoreItem>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly complianceService: ComplianceService,
    private readonly solapiService: SolapiService,
    private readonly bidsService: BidsService,
  ) {}

  async findAll(): Promise<any[]> {
    const rows = await this.dataSource.query(`
      SELECT si.*, i.carHash, i.firstCompletedAt, i.checkedDamages,
        CASE WHEN i.carHash IS NOT NULL THEN 1 ELSE 0 END AS hasReport
      FROM store_items si
      LEFT JOIN inspections i ON i.bookingId = si.bookingId
      ORDER BY
        CASE WHEN i.carHash IS NOT NULL THEN 0 ELSE 1 END,
        si.registeredAt DESC
    `);

    // store_items.accident은 등록 시 수동 입력값이라 실제 진단 결과(checkedDamages)와
    // 어긋날 수 있음 — 실제 손상마커가 하나라도 있으면 accident를 무조건 true로 덮어써서
    // "완전무사고"라고 잘못 표시되는 일이 없게 함(진단 데이터가 항상 최종 근거)
    for (const r of rows) {
      if (r.checkedDamages) {
        try {
          const damages = typeof r.checkedDamages === 'string' ? JSON.parse(r.checkedDamages) : r.checkedDamages;
          if (Array.isArray(damages) && damages.some((d: any) => Array.isArray(d) && d.length > 0)) {
            r.accident = true;
          }
        } catch { /* 파싱 실패 시 기존 accident 값 유지 */ }
      }
      delete r.checkedDamages;
    }

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

    // auctionStartAt/auctionEndAt이 없는 active 매물(경매 스케줄링 기능 추가 이전에
    // 이미 게시된 건) → 등록일 기준으로 마감시각을 보정해서 "진행중인데 마감" 오표시 방지
    const toBackfill = rows.filter((r: any) => r.status === 'active' && !r.auctionEndAt);
    for (const r of toBackfill) {
      const start = r.auctionStartAt ? new Date(r.auctionStartAt) : new Date(r.registeredAt ?? now);
      const auctionEndAt = computeAuctionEndAt(start);
      await this.dataSource.query(
        `UPDATE store_items SET auctionStartAt = ?, auctionEndAt = ? WHERE id = ?`,
        [start, auctionEndAt, r.id],
      );
      r.auctionStartAt = start;
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

  async findByUser(userId: number): Promise<any[]> {
    // findAll()과 동일하게 inspections를 JOIN해서 hasReport/carHash를 계산해야 함.
    // repo.find()로 store_items 원본만 반환하면 hasReport가 항상 기본값(false)이라
    // 이미 진단완료된 매물도 마이페이지에서 "검차 신청"이 다시 노출되는 버그가 있었음.
    return this.dataSource.query(
      `
      SELECT si.*, i.carHash, i.firstCompletedAt,
        CASE WHEN i.carHash IS NOT NULL THEN 1 ELSE 0 END AS hasReport
      FROM store_items si
      LEFT JOIN inspections i ON i.bookingId = si.bookingId
      WHERE si.userId = ?
      ORDER BY si.registeredAt DESC
      `,
      [userId],
    );
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

    // 셀프등록도 일반 매물과 동일하게 pending으로 시작 — 대시보드의 기존 "입금확인 후
    // 승인" 게이트(store-list.tsx)를 그대로 거쳐야 함. 여기서 바로 active로 만들면
    // 관리자 승인 없이 아무나 등록한 매물이 즉시 노출돼버림.
    const registrationOcr = (data as any).registrationOcr;
    delete (data as any).registrationOcr; // StoreItem 컬럼이 아니므로 저장 전에 제거

    const item = this.repo.create({ ...data, status: 'pending', ownerAccessToken: genOwnerAccessToken() });
    const saved = await this.repo.save(item);

    // 자동차관리법 시행규칙 제144조의3 — 셀프등록 시 프론트에서 이미 스캔해둔 등록증
    // OCR 결과가 있으면 3년 보관 기록으로 스냅샷. 실패해도 매물 등록은 이미 끝남.
    if (registrationOcr) {
      this.complianceService
        .captureFromParsedOcr({
          ocr: registrationOcr,
          storeItemId: saved.id,
          plateNumberFallback: saved.carNumber,
        })
        .catch(() => { /* 로그는 서비스 내부에서 이미 남김 */ });
    }

    return saved;
  }

  async update(id: number, data: Partial<StoreItem>): Promise<StoreItem> {
    const item = await this.repo.findOneBy({ id });
    if (!item) throw new NotFoundException(`스토어 아이템 ${id}를 찾을 수 없습니다.`);

    // pending → active로 승인되는 시점(진단완료 자동게시든, 셀프등록 관리자 승인이든)에
    // 경매 시작/마감 시각이 아직 없으면 그때 처음 세팅 — "등록일"이 아니라 "승인일" 기준으로
    // 48h/72h 카운트가 시작되게 함
    if (data.status === 'active' && item.status !== 'active' && !item.auctionStartAt) {
      const now = new Date();
      data.auctionStartAt = now;
      data.auctionEndAt = computeAuctionEndAt(now);
      if (!item.ownerAccessToken) data.ownerAccessToken = genOwnerAccessToken();
    }

    // saleStage 전환 시 해당 단계 타임스탬프 자동 스탬프 (호출부가 직접 안 챙겨도 되게)
    if (data.saleStage && data.saleStage !== item.saleStage) {
      const now = new Date();
      if (data.saleStage === 'winner_selected' && !item.winnerSelectedAt) data.winnerSelectedAt = now;
      if (data.saleStage === 'in_transit' && !item.inTransitAt) data.inTransitAt = now;
      if (data.saleStage === 'transit_done' && !item.transitDoneAt) data.transitDoneAt = now;
      if (data.saleStage === 'completed' && !item.completedAt) data.completedAt = now;
    }

    Object.assign(item, data);
    return this.repo.save(item);
  }

  async findByToken(token: string): Promise<StoreItem> {
    const item = await this.repo.findOneBy({ ownerAccessToken: token });
    if (!item) throw new NotFoundException('매물을 찾을 수 없습니다.');
    return item;
  }

  // 차주가 익명 토큰 페이지에서 "판매요청" — 확정 아님, 관리자 알림만 발송.
  // 실제 낙찰 확정은 관리자가 대시보드에서 bids.service.ts:selectWinner()로 처리.
  async requestSale(token: string, bidId: number): Promise<{ ok: true }> {
    const item = await this.findByToken(token);
    if (item.status !== 'active') throw new BadRequestException('이미 처리된 매물입니다.');

    const bids = await this.bidsService.findByItem(item.id);
    const bid = bids.find((b) => b.id === bidId);
    if (!bid) throw new NotFoundException('입찰 내역을 찾을 수 없습니다.');

    item.ownerRequestedBidId = bid.id;
    item.ownerRequestedAt = new Date();
    await this.repo.save(item);

    try {
      const priceMan = Math.round(Number(bid.amount) / 10_000);
      await this.solapiService.sendSms(
        '01022856017',
        `[카비어]${item.carNumber || ''} 차주가 ${bid.dealerName}(${priceMan}만) 판매요청, 확정필요`,
      );
    } catch {
      // 알림 실패해도 요청 저장은 정상 처리
    }

    return { ok: true };
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
