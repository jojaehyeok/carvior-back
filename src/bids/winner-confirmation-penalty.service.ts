import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { StoreItem } from '../store-items/entities/store-item.entity';
import { Bid } from './entities/bid.entity';
import { User } from '../users/entities/user.entity';
import { DealerPenaltiesService } from '../dealer-penalties/dealer-penalties.service';
import { SolapiService } from '../solapi/solapi.service';

const WINDOW_HOURS = 2;
const PENALTY_DAYS = 7;

// 딜바타(딜러앱) 낙찰 후 2시간 이내 "견적 재확인" 미응답 시 7일 입찰정지 페널티 부여.
// 매물당 한 번만 페널티가 나가도록 dealer_penalties.storeItemId 존재 여부로 dedup.
@Injectable()
export class WinnerConfirmationPenaltyService {
  private readonly logger = new Logger(WinnerConfirmationPenaltyService.name);

  constructor(
    @InjectRepository(StoreItem)
    private readonly storeItemRepo: Repository<StoreItem>,
    @InjectRepository(Bid)
    private readonly bidRepo: Repository<Bid>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dealerPenaltiesService: DealerPenaltiesService,
    private readonly solapiService: SolapiService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkUnconfirmedWinners(): Promise<void> {
    const deadline = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

    const overdue = await this.storeItemRepo
      .createQueryBuilder('s')
      .where('s.saleStage = :stage', { stage: 'winner_selected' })
      .andWhere('s.winnerSelectedAt IS NOT NULL')
      .andWhere('s.winnerSelectedAt <= :deadline', { deadline })
      .andWhere('s.winnerConfirmedAt IS NULL')
      .getMany();

    for (const item of overdue) {
      if (!item.winningBidId) continue;
      if (await this.dealerPenaltiesService.existsForItem(item.id)) continue; // 이미 처리됨

      try {
        const bid = await this.bidRepo.findOneBy({ id: item.winningBidId });
        if (!bid?.dealerId) continue;

        await this.dealerPenaltiesService.create(
          bid.dealerId,
          'unconfirmed_winner',
          PENALTY_DAYS,
          item.id,
          `${item.carNumber || ''} 낙찰 후 ${WINDOW_HOURS}시간 이내 견적 재확인 미응답`,
        );

        const dealer = await this.userRepo.findOneBy({ id: bid.dealerId });
        if (dealer?.phone) {
          try {
            await this.solapiService.sendSms(
              dealer.phone,
              `[카비어 딜바타] ${item.carNumber || ''} 견적 재확인 미응답으로 ${PENALTY_DAYS}일간 입찰이 제한됩니다.`,
            );
          } catch { /* 알림 실패해도 페널티는 정상 적용 */ }
        }
      } catch (e) {
        this.logger.error(`[낙찰확인페널티] 실패 storeItemId=${item.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}
