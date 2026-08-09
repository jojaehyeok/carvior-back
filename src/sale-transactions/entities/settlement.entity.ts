import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// 하나의 totalFee로 합쳐서 저장하지 않고 항목별로 분리(스펙 9번 금지사항).
// 결정사항(2026-08-09): 중개수수료는 스마트옥션(StoreItem)과 동일하게 받지 않음(brokerageFee
// 는 0으로 고정, 필드는 남겨둠 — 정책이 바뀌면 여기만 고치면 됨). 탁송료 기본 부담 주체는
// 딜러(매수자)라 sellerDeduction은 대부분 0이 된다.
@Entity('settlements')
export class Settlement {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  transactionId: number;

  @Column({ type: 'bigint' })
  vehiclePrice: number;

  @Column({ type: 'bigint', default: 0 })
  transportFee: number;

  @Column({ type: 'bigint', default: 0 })
  brokerageFee: number;

  @Column({ type: 'bigint', default: 0 })
  pgFee: number;

  @Column({ type: 'bigint', default: 0 })
  otherFee: number;

  @Column({ type: 'bigint', default: 0 })
  sellerDeduction: number;

  @Column({ type: 'bigint' })
  sellerPayout: number;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  paidAt: Date | null;
}
