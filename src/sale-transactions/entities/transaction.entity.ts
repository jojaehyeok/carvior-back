import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// 낙찰 확정 시 생성 — 이후 에스크로/탁송/정산은 전부 이 Transaction 기준으로 연결된다(스펙 6번).
@Entity('sale_transactions')
export class Transaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  listingId: number;

  @Column()
  vehicleId: number;

  // 실제 차주 — 로그인 계정이 있으면 연결(느슨한 연결, FK 제약 없음 — 이 프로젝트 관례와 동일)
  @Column({ type: 'int', nullable: true })
  sellerId: number | null;

  @Column({ type: 'int', nullable: true })
  dealerId: number | null;

  @Column()
  dealerName: string;

  @Column({ type: 'bigint' })
  winningBidAmount: number;

  // AWAITING_ESCROW_PAYMENT | ESCROW_PAID | TRANSPORT_READY | TRANSPORT_IN_PROGRESS |
  // VEHICLE_PICKED_UP | SETTLEMENT_PENDING | SETTLEMENT_RELEASE_REQUESTED | SELLER_PAID |
  // DELIVERED | COMPLETED | CANCELLED | PAYMENT_FAILED | TRANSPORT_FAILED | REFUND_PENDING | REFUNDED
  @Column({ default: 'AWAITING_ESCROW_PAYMENT' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
