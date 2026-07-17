import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bid } from './entities/bid.entity';
import { StoreItem } from '../store-items/entities/store-item.entity';
import { User } from '../users/entities/user.entity';
import { SolapiService } from '../solapi/solapi.service';

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
  ) {}

  async create(storeItemId: number, dealerId: number | null, dealerName: string, amount: number) {
    const item = await this.storeItemRepo.findOneBy({ id: storeItemId });
    if (!item) throw new NotFoundException('매물을 찾을 수 없습니다.');

    const bid = this.repo.create({ storeItemId, dealerId: dealerId ?? undefined, dealerName, amount });
    const saved = await this.repo.save(bid);

    // 셀프등록(진단 없이 판매자가 직접 올린) 매물이면 딜러가 입찰할 때마다 판매자에게 SMS로 알림
    // — 알림톡 템플릿은 아직 검수 중이라 우선 SMS로 발송, 승인되면 알림톡으로 전환 예정
    if (item.selfRegistered && item.sellerContact) {
      try {
        const text = buildShortSms(item.carNumber || '내 차량', `${dealerName}님이 관심을 보였습니다. 확인해주세요.`);
        await this.solapiService.sendSms(item.sellerContact, text);
      } catch {
        // 알림 실패해도 입찰 저장은 정상 처리
      }
    }

    return saved;
  }

  findByItem(storeItemId: number) {
    return this.repo.find({ where: { storeItemId }, order: { amount: 'DESC' } });
  }

  // 관리자가 특정 입찰(딜러)을 낙찰자로 확정 — 매물 마감 처리 + 판매자·낙찰딜러 양쪽에 SMS 안내
  async selectWinner(bidId: number) {
    const bid = await this.repo.findOneBy({ id: bidId });
    if (!bid) throw new NotFoundException('입찰 내역을 찾을 수 없습니다.');

    const item = await this.storeItemRepo.findOneBy({ id: bid.storeItemId });
    if (!item) throw new NotFoundException('매물을 찾을 수 없습니다.');

    item.status = 'sold';
    (item as any).auctionEndAt = new Date();
    await this.storeItemRepo.save(item);

    // 판매자에게: 딜러가 확정됐다는 안내
    if (item.sellerContact) {
      try {
        const text = buildShortSms(item.carNumber || '내 차량', `딜러(${bid.dealerName})가 확정됐습니다. 곧 연락드릴 예정입니다.`);
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
