import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// 차량판매중개 시스템(5단계, 딜러 경쟁입찰) 전용 — 기존 스마트옥션(StoreItem)의
// `bids` 테이블과는 완전히 별개(1단계 결정: 새 시스템 별도 구축). SaleListing 1개당
// 여러 SaleBid가 달릴 수 있다.
@Entity('sale_bids')
export class SaleBid {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  listingId: number;

  @Column({ type: 'int', nullable: true })
  dealerId: number | null;

  @Column()
  dealerName: string;

  @Column({ type: 'bigint' })
  amount: number;

  // ACTIVE(입찰중) | WITHDRAWN | WINNER | LOST
  @Column({ default: 'ACTIVE' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;
}
