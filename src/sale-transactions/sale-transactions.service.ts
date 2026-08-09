import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SaleBid } from './entities/sale-bid.entity';
import { Transaction } from './entities/transaction.entity';
import { EscrowPayment } from './entities/escrow-payment.entity';
import { SaleTransport } from './entities/sale-transport.entity';
import { Settlement } from './entities/settlement.entity';
import { SaleListing } from '../sale-listings/entities/sale-listing.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { ESCROW_PROVIDER } from './escrow/escrow-provider.interface';
import type { EscrowProvider } from './escrow/escrow-provider.interface';

@Injectable()
export class SaleTransactionsService {
  constructor(
    @InjectRepository(SaleBid) private readonly bidRepo: Repository<SaleBid>,
    @InjectRepository(Transaction) private readonly txRepo: Repository<Transaction>,
    @InjectRepository(EscrowPayment) private readonly escrowRepo: Repository<EscrowPayment>,
    @InjectRepository(SaleTransport) private readonly transportRepo: Repository<SaleTransport>,
    @InjectRepository(Settlement) private readonly settlementRepo: Repository<Settlement>,
    @InjectRepository(SaleListing) private readonly listingRepo: Repository<SaleListing>,
    @InjectRepository(Vehicle) private readonly vehicleRepo: Repository<Vehicle>,
    @Inject(ESCROW_PROVIDER) private readonly escrowProvider: EscrowProvider,
  ) {}

  // ── 5단계: 딜러 경쟁입찰 ──────────────────────────────────────────────
  async submitBid(listingId: number, dealerId: number | null, dealerName: string, amount: number): Promise<SaleBid> {
    const listing = await this.listingRepo.findOneBy({ id: listingId });
    if (!listing) throw new NotFoundException(`매물 ${listingId}을 찾을 수 없습니다.`);
    if (!['ACTIVE', 'TARGET_PRICE_MET'].includes(listing.listingStatus)) {
      throw new BadRequestException('입찰 기간이 아닌 매물입니다.');
    }
    const now = Date.now();
    if (listing.biddingEndAt && now > new Date(listing.biddingEndAt).getTime()) {
      throw new BadRequestException('입찰 마감된 매물입니다.');
    }
    if (!amount || amount <= 0) throw new BadRequestException('입찰가를 입력해주세요.');

    const bid = await this.bidRepo.save(this.bidRepo.create({ listingId, dealerId, dealerName, amount }));

    // 희망가 이상이어도 자동낙찰 금지 — 상태 표시만 바꾼다(스펙 5번)
    if (Number(listing.askingPrice) > 0 && amount >= Number(listing.askingPrice) && listing.listingStatus === 'ACTIVE') {
      listing.listingStatus = 'TARGET_PRICE_MET';
      await this.listingRepo.save(listing);
    }
    return bid;
  }

  // 딜러 목록 화면 — 경쟁입찰 원칙상 다른 딜러 금액은 숨기고 건수만 보여줌
  async findBidsForDealer(listingId: number, dealerId?: number) {
    const bids = await this.bidRepo.find({ where: { listingId }, order: { amount: 'DESC' } });
    return bids.map((b) => ({
      id: b.id,
      status: b.status,
      createdAt: b.createdAt,
      isMine: dealerId != null && b.dealerId === dealerId,
      amount: dealerId != null && b.dealerId === dealerId ? Number(b.amount) : undefined,
    }));
  }

  // 관리자용 — 전체 금액 공개
  findBidsForAdmin(listingId: number) {
    return this.bidRepo.find({ where: { listingId }, order: { amount: 'DESC' } });
  }

  findMyBids(dealerId: number) {
    return this.bidRepo.find({ where: { dealerId }, order: { createdAt: 'DESC' } });
  }

  // ── 6~7단계: 차주 낙찰승인(관리자 대행) + Transaction 생성 ──────────────
  // 차주용 웹 화면은 아직 없어서(3단계 결정과 동일) 관리자가 전화로 차주 승인을 확인한 뒤
  // 대시보드에서 낙찰을 확정한다. 승인 즉시: SaleBid→WINNER/LOST, SaleListing→AWARDED,
  // Transaction(AWAITING_ESCROW_PAYMENT) + EscrowPayment(PAYMENT_PENDING) 생성.
  async selectWinner(listingId: number, bidId: number): Promise<Transaction> {
    const listing = await this.listingRepo.findOneBy({ id: listingId });
    if (!listing) throw new NotFoundException(`매물 ${listingId}을 찾을 수 없습니다.`);
    const winningBid = await this.bidRepo.findOneBy({ id: bidId, listingId });
    if (!winningBid) throw new NotFoundException(`입찰 ${bidId}을 찾을 수 없습니다.`);
    if (listing.listingStatus === 'AWARDED') {
      throw new BadRequestException('이미 낙찰이 확정된 매물입니다.');
    }

    const vehicle = await this.vehicleRepo.findOneBy({ id: listing.vehicleId });

    winningBid.status = 'WINNER';
    await this.bidRepo.save(winningBid);
    await this.bidRepo
      .createQueryBuilder()
      .update()
      .set({ status: 'LOST' })
      .where('listingId = :listingId AND id != :bidId', { listingId, bidId })
      .execute();

    listing.listingStatus = 'AWARDED';
    listing.winningBidId = winningBid.id;
    await this.listingRepo.save(listing);

    const tx = await this.txRepo.save(
      this.txRepo.create({
        listingId,
        vehicleId: listing.vehicleId,
        sellerId: vehicle?.ownerUserId ?? null,
        dealerId: winningBid.dealerId,
        dealerName: winningBid.dealerName,
        winningBidAmount: winningBid.amount,
        status: 'AWAITING_ESCROW_PAYMENT',
      }),
    );

    const { pgTransactionId } = await this.escrowProvider.createPayment(tx.id, Number(winningBid.amount));
    await this.escrowRepo.save(
      this.escrowRepo.create({
        transactionId: tx.id,
        pgProvider: 'mock',
        pgTransactionId,
        amount: winningBid.amount,
        escrowStatus: 'PAYMENT_PENDING',
      }),
    );

    return tx;
  }

  // ── 8단계: 에스크로 결제 ────────────────────────────────────────────
  // 실제 PG 웹훅이 아직 없어서(12단계 대상) 관리자가 육안 확인 후 수동으로 전환 —
  // 이 프로젝트의 기존 확인 패턴(StoreItem.confirmDeposit 등)과 동일한 방식.
  async confirmEscrowPaid(transactionId: number): Promise<Transaction> {
    const tx = await this.getTransaction(transactionId);
    if (tx.status !== 'AWAITING_ESCROW_PAYMENT') {
      throw new BadRequestException('에스크로 입금 대기 상태가 아닙니다.');
    }
    const escrow = await this.escrowRepo.findOneBy({ transactionId });
    if (!escrow) throw new NotFoundException('에스크로 결제 정보를 찾을 수 없습니다.');
    escrow.escrowStatus = 'PAID_TO_ESCROW';
    escrow.paidAt = new Date();
    await this.escrowRepo.save(escrow);

    tx.status = 'TRANSPORT_READY';
    return this.txRepo.save(tx);
  }

  // ── 9단계: 탁송 상태관리 ────────────────────────────────────────────
  // PAID_TO_ESCROW 이전에는 탁송 시작 금지(스펙 8번 금지사항)
  async requestTransport(
    transactionId: number,
    dto: { pickupAddress: string; destinationAddress: string; pickupContact: string; deliveryContact: string; transportFee?: number; payer?: 'SELLER' | 'DEALER' },
  ): Promise<SaleTransport> {
    const tx = await this.getTransaction(transactionId);
    const escrow = await this.escrowRepo.findOneBy({ transactionId });
    if (!escrow || escrow.escrowStatus !== 'PAID_TO_ESCROW') {
      throw new BadRequestException('에스크로 입금 확인 전에는 탁송을 요청할 수 없습니다.');
    }
    const existing = await this.transportRepo.findOneBy({ transactionId });
    if (existing) throw new BadRequestException('이미 탁송이 신청된 거래입니다.');

    const transport = await this.transportRepo.save(
      this.transportRepo.create({
        transactionId,
        pickupAddress: dto.pickupAddress,
        destinationAddress: dto.destinationAddress,
        pickupContact: dto.pickupContact,
        deliveryContact: dto.deliveryContact,
        transportFee: dto.transportFee ?? null,
        payer: dto.payer ?? 'DEALER',
        transportStatus: 'TRANSPORT_REQUESTED',
      }),
    );

    tx.status = 'TRANSPORT_IN_PROGRESS';
    await this.txRepo.save(tx);
    return transport;
  }

  async updateTransportStatus(transactionId: number, status: string): Promise<SaleTransport> {
    const transport = await this.transportRepo.findOneBy({ transactionId });
    if (!transport) throw new NotFoundException('탁송 정보를 찾을 수 없습니다.');
    const tx = await this.getTransaction(transactionId);

    transport.transportStatus = status;
    if (status === 'PICKUP_CONFIRMED') transport.pickupAt = new Date();
    if (status === 'DELIVERED') transport.deliveredAt = new Date();
    await this.transportRepo.save(transport);

    // 차주에게서 차량 인수가 확인되면(픽업 완료) 정산 단계로 자동 진행 — 정산액은 이 시점에
    // 확정되는 탁송료를 반영해서 계산한다(스펙 10번 흐름).
    if (status === 'PICKUP_CONFIRMED') {
      await this.computeSettlement(transactionId, transport);
      tx.status = 'SETTLEMENT_PENDING';
      await this.txRepo.save(tx);
    } else if (status === 'DELIVERED') {
      if (tx.status !== 'SELLER_PAID') {
        throw new BadRequestException('차주 정산 지급 확인 전에는 딜러 배송 완료 처리를 할 수 없습니다.');
      }
      tx.status = 'COMPLETED';
      await this.txRepo.save(tx);
    } else {
      if (tx.status === 'TRANSPORT_READY') {
        tx.status = 'TRANSPORT_IN_PROGRESS';
        await this.txRepo.save(tx);
      }
    }

    return transport;
  }

  // ── 10단계: 수수료 계산 + Settlement ─────────────────────────────────
  // 하나의 금액으로 합치지 않고 항목별로 분리(스펙 9번 금지사항). 중개수수료는 스마트옥션과
  // 동일하게 받지 않기로 결정(2026-08-09)했으므로 항상 0.
  private async computeSettlement(transactionId: number, transport: SaleTransport): Promise<Settlement> {
    const tx = await this.getTransaction(transactionId);
    const transportFee = Number(transport.transportFee ?? 0);
    const brokerageFee = 0;
    const pgFee = 0;
    const otherFee = 0;
    const sellerDeduction = transport.payer === 'SELLER' ? transportFee : 0;
    const sellerPayout = Number(tx.winningBidAmount) - sellerDeduction - brokerageFee - pgFee - otherFee;

    const existing = await this.settlementRepo.findOneBy({ transactionId });
    const settlement = existing ?? this.settlementRepo.create({ transactionId });
    settlement.vehiclePrice = tx.winningBidAmount;
    settlement.transportFee = transportFee;
    settlement.brokerageFee = brokerageFee;
    settlement.pgFee = pgFee;
    settlement.otherFee = otherFee;
    settlement.sellerDeduction = sellerDeduction;
    settlement.sellerPayout = sellerPayout;
    return this.settlementRepo.save(settlement);
  }

  // 관리자가 PG/에스크로에 지급 실행을 요청했다고 표시 — 아직 실제 PG 연동 전이라
  // 카카오뱅크 계좌 등으로 수동 송금 후 아래 confirmSellerPaid로 최종 확인한다.
  async confirmSettlementReleaseRequested(transactionId: number): Promise<Transaction> {
    const tx = await this.getTransaction(transactionId);
    if (tx.status !== 'SETTLEMENT_PENDING') {
      throw new BadRequestException('정산 대기 상태가 아닙니다.');
    }
    const escrow = await this.escrowRepo.findOneBy({ transactionId });
    if (escrow) {
      escrow.escrowStatus = 'RELEASE_REQUESTED';
      await this.escrowRepo.save(escrow);
    }
    tx.status = 'SETTLEMENT_RELEASE_REQUESTED';
    return this.txRepo.save(tx);
  }

  async confirmSellerPaid(transactionId: number): Promise<Transaction> {
    const tx = await this.getTransaction(transactionId);
    if (tx.status !== 'SETTLEMENT_RELEASE_REQUESTED') {
      throw new BadRequestException('정산 지급 요청 상태가 아닙니다.');
    }
    const escrow = await this.escrowRepo.findOneBy({ transactionId });
    if (escrow) {
      escrow.escrowStatus = 'RELEASED';
      escrow.releasedAt = new Date();
      await this.escrowRepo.save(escrow);
    }
    const settlement = await this.settlementRepo.findOneBy({ transactionId });
    if (settlement) {
      settlement.paidAt = new Date();
      await this.settlementRepo.save(settlement);
    }
    tx.status = 'SELLER_PAID';
    return this.txRepo.save(tx);
  }

  // ── 11단계: 관리자 전체 거래관리 화면 ─────────────────────────────────
  async findAllTransactionsAdmin() {
    return this.txRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findOneTransactionAdmin(id: number) {
    const tx = await this.getTransaction(id);
    const [escrow, transport, settlement, bids] = await Promise.all([
      this.escrowRepo.findOneBy({ transactionId: id }),
      this.transportRepo.findOneBy({ transactionId: id }),
      this.settlementRepo.findOneBy({ transactionId: id }),
      this.bidRepo.find({ where: { listingId: tx.listingId }, order: { amount: 'DESC' } }),
    ]);
    return { ...tx, escrow, transport, settlement, bids };
  }

  findMyTransactions(dealerId: number) {
    return this.txRepo.find({ where: { dealerId }, order: { createdAt: 'DESC' } });
  }

  private async getTransaction(id: number): Promise<Transaction> {
    const tx = await this.txRepo.findOneBy({ id });
    if (!tx) throw new NotFoundException(`거래 ${id}를 찾을 수 없습니다.`);
    return tx;
  }
}
