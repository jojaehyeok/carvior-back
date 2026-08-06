import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { StoreItem } from './entities/store-item.entity';
import { BidsService } from '../bids/bids.service';
import { SolapiService } from '../solapi/solapi.service';

// 경매 마감 시각이 지난 매물의 판매자에게 입찰 요약(건수/최고가)을 SMS로 안내.
// status를 보고 판단하지 않고 deadlineNotifiedAt을 별도 dedup 키로 쓴다 —
// store-items.service.ts:findAll()이 매 조회마다 active→closed를 먼저 뒤집어버릴 수 있어서
// status='active' 조건으로 걸면 대시보드가 먼저 훑고 지나간 매물은 크론이 영영 못 찾는다.
@Injectable()
export class AuctionDeadlineNotifierService {
  private readonly logger = new Logger(AuctionDeadlineNotifierService.name);

  constructor(
    @InjectRepository(StoreItem)
    private readonly repo: Repository<StoreItem>,
    private readonly bidsService: BidsService,
    private readonly solapiService: SolapiService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async notifyEndedAuctions(): Promise<void> {
    const now = new Date();
    const due = await this.repo
      .createQueryBuilder('s')
      .where('s.auctionEndAt IS NOT NULL')
      .andWhere('s.auctionEndAt <= :now', { now })
      .andWhere('s.deadlineNotifiedAt IS NULL')
      .andWhere('s.sellerContact IS NOT NULL')
      .getMany();

    for (const item of due) {
      try {
        const bids = await this.bidsService.findByItem(item.id);
        const top = bids[0];
        const link = item.ownerAccessToken ? `https://carvior.store/my-listing/${item.ownerAccessToken}` : '';

        let detail = bids.length
          ? `경매마감 입찰${bids.length}건 최고${Math.round(Number(top.amount) / 10_000)}만`
          : '경매마감 입찰없음';
        let text = `[카비어] ${item.carNumber || ''} ${detail}`;
        while (Buffer.byteLength(`${text}\n${link}`, 'utf-8') > 88 && detail.length > 1) {
          detail = detail.slice(0, -1);
          text = `[카비어] ${item.carNumber || ''} ${detail}…`;
        }
        await this.solapiService.sendSms(item.sellerContact, link ? `${text}\n${link}` : text);
      } catch (e) {
        this.logger.error(`[경매마감알림] 실패 id=${item.id}: ${e instanceof Error ? e.message : e}`);
      } finally {
        // 발송 성공/실패 여부와 무관하게 스탬프 — 실패건이 5분마다 무한 재시도되는 것을 방지
        item.deadlineNotifiedAt = new Date();
        if (item.status === 'active') item.status = 'closed';
        await this.repo.save(item);
      }
    }
  }
}
