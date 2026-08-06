import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { RentalListing } from './entities/rental-listing.entity';
import { RentalBid } from './entities/rental-bid.entity';
import { SolapiService } from '../solapi/solapi.service';

function genOwnerAccessToken(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

@Injectable()
export class RentalService {
  constructor(
    @InjectRepository(RentalListing)
    private readonly repo: Repository<RentalListing>,
    @InjectRepository(RentalBid)
    private readonly bidRepo: Repository<RentalBid>,
    private readonly solapiService: SolapiService,
  ) {}

  findAll(): Promise<RentalListing[]> {
    return this.repo.find({ order: { registeredAt: 'DESC' } });
  }

  async findOne(id: number): Promise<RentalListing> {
    const item = await this.repo.findOneBy({ id });
    if (!item) throw new NotFoundException('렌트 매물을 찾을 수 없습니다.');
    return item;
  }

  async create(data: Partial<RentalListing>): Promise<RentalListing> {
    const item = this.repo.create({ ...data, ownerAccessToken: genOwnerAccessToken() });
    return this.repo.save(item);
  }

  async update(id: number, data: Partial<RentalListing>): Promise<RentalListing> {
    const item = await this.findOne(id);
    if (!item.ownerAccessToken) data.ownerAccessToken = genOwnerAccessToken();
    Object.assign(item, data);
    return this.repo.save(item);
  }

  async remove(id: number): Promise<void> {
    const item = await this.findOne(id);
    await this.repo.remove(item);
  }

  async findByToken(token: string): Promise<RentalListing> {
    const item = await this.repo.findOneBy({ ownerAccessToken: token });
    if (!item) throw new NotFoundException('매물을 찾을 수 없습니다.');
    return item;
  }

  // 낮은 지원금 요청 순으로 정렬 — 승계자가 적게 받겠다고 할수록(=차주에게 유리) 상위
  findBidsByListing(rentalListingId: number): Promise<RentalBid[]> {
    return this.bidRepo.find({ where: { rentalListingId }, order: { requestedSubsidy: 'ASC' } });
  }

  async createBid(rentalListingId: number, bidderName: string, bidderContact: string | undefined, requestedSubsidy: number): Promise<RentalBid> {
    const item = await this.findOne(rentalListingId);
    if (item.status !== 'active') throw new BadRequestException('이미 마감된 매물입니다.');

    const bid = this.bidRepo.create({ rentalListingId, bidderName, bidderContact, requestedSubsidy });
    const saved = await this.bidRepo.save(bid);

    if (item.sellerContact) {
      try {
        const won = Math.round(Number(requestedSubsidy) / 10_000);
        await this.solapiService.sendSms(item.sellerContact, `[카비어] ${item.carNumber || '내 렌트차량'} ${bidderName}님이 지원금 ${won}만원에 승계 희망했습니다.`);
      } catch { /* 알림 실패해도 입찰 저장은 정상 처리 */ }
    }

    return saved;
  }

  // 차주가 익명 토큰 페이지에서 특정 입찰을 선택 — 확정 아님, 관리자 알림만.
  async requestMatch(token: string, bidId: number): Promise<{ ok: true }> {
    const item = await this.findByToken(token);
    if (item.status !== 'active') throw new BadRequestException('이미 처리된 매물입니다.');

    const bids = await this.findBidsByListing(item.id);
    const bid = bids.find((b) => b.id === bidId);
    if (!bid) throw new NotFoundException('입찰 내역을 찾을 수 없습니다.');

    try {
      const won = Math.round(Number(bid.requestedSubsidy) / 10_000);
      await this.solapiService.sendSms('01022856017', `[카비어 렌트승계] ${item.carNumber || ''} 차주가 ${bid.bidderName}(지원금 ${won}만) 선택, 확정필요`);
    } catch { /* 알림 실패해도 정상 처리 */ }

    return { ok: true };
  }

  // 관리자가 최종 승계자 확정
  async selectWinner(bidId: number): Promise<{ ok: true; item: RentalListing; bid: RentalBid }> {
    const bid = await this.bidRepo.findOneBy({ id: bidId });
    if (!bid) throw new NotFoundException('입찰 내역을 찾을 수 없습니다.');

    const item = await this.findOne(bid.rentalListingId);
    item.status = 'matched';
    item.winningBidId = bid.id;
    item.matchedAt = new Date();
    await this.repo.save(item);

    if (item.sellerContact) {
      try {
        await this.solapiService.sendSms(item.sellerContact, `[카비어] ${item.carNumber || '내 렌트차량'} 승계자(${bid.bidderName})가 확정됐습니다. 곧 연락드릴 예정입니다.`);
      } catch { /* */ }
    }
    if (bid.bidderContact) {
      try {
        const contactPart = item.sellerContact ? ` (연락처 ${item.sellerContact})` : '';
        await this.solapiService.sendSms(bid.bidderContact, `[카비어] ${item.carNumber || '차량'} 승계가 확정되었습니다. 차주와 직접 일정을 잡아주세요${contactPart}.`);
      } catch { /* */ }
    }

    return { ok: true, item, bid };
  }
}
