import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// 에스크로 입금 완료(PAID_TO_ESCROW) 이후에만 생성 가능(스펙 8번 금지사항).
// 기존 StoreItem.transportRequestedAt류(구 에스크로 시스템)와는 완전히 별개 — 이 시스템
// 전용 탁송 레코드.
@Entity('sale_transports')
export class SaleTransport {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  transactionId: number;

  @Column()
  pickupAddress: string;

  @Column()
  destinationAddress: string;

  @Column()
  pickupContact: string;

  @Column()
  deliveryContact: string;

  @Column({ type: 'bigint', nullable: true })
  transportFee: number | null;

  // 탁송료 부담 주체 — 기본값은 딜러(매수자) 부담이지만 거래마다 바꿀 수 있게 필드로 둠
  @Column({ default: 'DEALER' })
  payer: string;

  // TRANSPORT_REQUESTED | DRIVER_ASSIGNED | PICKUP_CONFIRMED | IN_TRANSIT | DELIVERED
  @Column({ default: 'TRANSPORT_REQUESTED' })
  transportStatus: string;

  @CreateDateColumn()
  requestedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  pickupAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt: Date | null;
}
