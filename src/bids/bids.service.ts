import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Bid } from './entities/bid.entity';
import { StoreItem } from '../store-items/entities/store-item.entity';
import { User } from '../users/entities/user.entity';
import { SolapiService } from '../solapi/solapi.service';
import { DealerPenaltiesService } from '../dealer-penalties/dealer-penalties.service';

const MAX_BIDS_PER_DAY = 30;

// SMS는 90byte 제한 — 초과분은 뒤에서부터 잘라내며 "…" 붙임 (재촬영요청 SMS와 동일 패턴)
function buildShortSms(title: string, detail: string): string {
  let d = detail;
  let text = `[카비어] ${title} ${d}`;
  while (Buffer.byteLength(text, 'utf-8') > 88 && d.length > 1) {
    d = d.slice(0, -1);
    text = `[카비어] ${title} ${d}…`;
  }
  return text;
}

@Injectable()
export class BidsService {
  constructor(
    @InjectRepository(Bid)
    private readonly repo: Repository<Bid>,
    @InjectRepository(StoreItem)
    private readonly storeItemRepo: Repository<StoreItem>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly solapiService: SolapiService,
    private readonly dealerPenaltiesService: DealerPenaltiesService,
  ) {}

  async create(storeItemId: number, dealerId: number | null, dealerName: string, amount: number) {
    const item = await this.storeItemRepo.findOneBy({ id: storeItemId });
    if (!item) throw new NotFoundException('매물을 찾을 수 없습니다.');

    if (dealerId) {
      if (await this.dealerPenaltiesService.isPenalized(dealerId)) {
        throw new ForbiddenException('현재 입찰이 제한된 상태입니다.');
      }
      const todayCount = await this.dealerPenaltiesService.countTodayBids(dealerId, this.repo);
      if (todayCount >= MAX_BIDS_PER_DAY) {
        throw new BadRequestException(`하루 입찰 가능 건수(${MAX_BIDS_PER_DAY}건)를 초과했습니다.`);
      }
    }

    const bid = this.repo.create({ storeItemId, dealerId: dealerId ?? undefined, dealerName, amount });
    const saved = await this.repo.save(bid);

    // 딜러가 입찰할 때마다 판매자에게 SMS로 알림 (검수출처 매물 포함 전체 확대)
    // — 알림톡 템플릿은 아직 검수 중이라 우선 SMS로 발송, 승인되면 알림톡으로 전환 예정
    if (item.sellerContact) {
      try {
        const link = item.ownerAccessToken ? `https://carvior.store/my-listing/${item.ownerAccessToken}` : '';
        let detail = `${dealerName}님이 관심을 보였습니다.`;
        let text = `[카비어] ${item.carNumber || '내 차량'} ${detail}`;
        while (Buffer.byteLength(`${text}\n${link}`, 'utf-8') > 88 && detail.length > 1) {
          detail = detail.slice(0, -1);
          text = `[카비어] ${item.carNumber || '내 차량'} ${detail}…`;
        }
        await this.solapiService.sendSms(item.sellerContact, link ? `${text}\n${link}` : text);
      } catch {
        // 알림 실패해도 입찰 저장은 정상 처리
      }
    }

    return saved;
  }

  // 낙찰 딜러가 앱에서 "네, 책임질 수 있는 견적입니다"를 눌렀을 때
  async confirmWinner(storeItemId: number, dealerId: number) {
    const item = await this.storeItemRepo.findOneBy({ id: storeItemId });
    if (!item) throw new NotFoundException('매물을 찾을 수 없습니다.');
    if (!item.winningBidId) throw new BadRequestException('낙찰 확정된 입찰이 없습니다.');

    const winningBid = await this.repo.findOneBy({ id: item.winningBidId });
    if (!winningBid || winningBid.dealerId !== dealerId) {
      throw new ForbiddenException('낙찰 딜러 본인만 확인할 수 있습니다.');
    }

    item.winnerConfirmedAt = new Date();
    await this.storeItemRepo.save(item);
    return { ok: true };
  }

  async getDealerPenaltyStatus(dealerId: number) {
    const active = await this.dealerPenaltiesService.listActive(dealerId);
    return { penalized: active.length > 0, penalties: active };
  }

  findByItem(storeItemId: number) {
    return this.repo.find({ where: { storeItemId }, order: { amount: 'DESC' } });
  }

  // 딜러앱 "입찰한 물건" / "낙찰한 물건" 목록 — 딜러의 입찰 건마다 매물 정보를 같이 붙여서 반환
  async findByDealer(dealerId: number) {
    const bids = await this.repo.find({ where: { dealerId }, order: { createdAt: 'DESC' } });
    if (!bids.length) return [];

    const itemIds = [...new Set(bids.map((b) => b.storeItemId))];
    const items = await this.storeItemRepo.findBy({ id: In(itemIds) });
    const itemMap = new Map(items.map((i) => [i.id, i]));

    return bids.map((bid) => {
      const item = itemMap.get(bid.storeItemId);
      return {
        ...bid,
        item: item
          ? {
              id: item.id,
              carNumber: item.carNumber,
              titleKo: item.titleKo,
              photos: item.photos,
              status: item.status,
              priceKRW: item.priceKRW,
              auctionEndAt: item.auctionEndAt,
            }
          : null,
        isWinning: !!item && item.winningBidId === bid.id,
      };
    });
  }

  // 관리자가 특정 입찰(딜러)을 낙찰자로 확정 — 매물 마감 처리 + 판매자·낙찰딜러 양쪽에 SMS 안내
  async selectWinner(bidId: number) {
    const bid = await this.repo.findOneBy({ id: bidId });
    if (!bid) throw new NotFoundException('입찰 내역을 찾을 수 없습니다.');

    const item = await this.storeItemRepo.findOneBy({ id: bid.storeItemId });
    if (!item) throw new NotFoundException('매물을 찾을 수 없습니다.');

    item.status = 'sold';
    item.auctionEndAt = new Date();
    item.saleStage = 'winner_selected';
    item.winnerSelectedAt = new Date();
    item.winningBidId = bid.id;
    await this.storeItemRepo.save(item);

    // 판매자에게: 딜러가 확정됐다는 안내
    if (item.sellerContact) {
      try {
        const link = item.ownerAccessToken ? `\nhttps://carvior.store/my-listing/${item.ownerAccessToken}` : '';
        const text = buildShortSms(item.carNumber || '내 차량', `딜러(${bid.dealerName})가 확정됐습니다. 곧 연락드릴 예정입니다.${link}`);
        await this.solapiService.sendSms(item.sellerContact, text);
      } catch { /* 알림 실패해도 낙찰 처리는 정상 진행 */ }
    }

    // 낙찰 딜러에게: 직접 방문하거나 평가사 방문을 요청하라는 안내
    if (bid.dealerId) {
      try {
        const dealer = await this.userRepo.findOneBy({ id: bid.dealerId });
        if (dealer?.phone) {
          const contactPart = item.sellerContact ? ` (연락처 ${item.sellerContact})` : '';
          const text = buildShortSms(item.carNumber || '차량', `낙찰되었습니다. 판매자와 직접 약속을 잡거나 평가사 방문을 요청해주세요${contactPart}.`);
          await this.solapiService.sendSms(dealer.phone, text);
        }
      } catch { /* 알림 실패해도 낙찰 처리는 정상 진행 */ }
    }

    return { ok: true, item, bid };
  }
}
