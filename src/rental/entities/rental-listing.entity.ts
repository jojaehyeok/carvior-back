import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// 렌트카 승계(양도양수) 매물 — 베타. 공개 페이지에 아직 링크 안 걸어둔 상태(다듬고 나서 공개 예정).
// 중고차 매물(store_items)과 달리 딜러가 "얼마에 살게요"로 높은 입찰이 이기는 게 아니라,
// 차주가 제시한 최대 지원금(maxSubsidy) 안에서 승계자가 "이만큼만 받아도 넘겨받을게요"로
// 더 낮은 금액을 부르는 역경매 — 월납입금/잔여개월 등 렌트사 계약조건 자체는 승계 후에도 고정.
@Entity('rental_listings')
export class RentalListing {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  carNumber: string;

  @Column({ nullable: true })
  titleKo: string;

  @Column({ nullable: true })
  titleEn: string;

  @Column({ nullable: true })
  trim: string;

  @Column({ nullable: true })
  year: number;

  @Column({ nullable: true })
  mileage: number;

  @Column({ nullable: true })
  fuel: string;

  @Column({ nullable: true })
  rentalCompany: string; // 렌트사명

  @Column({ type: 'bigint', nullable: true })
  monthlyPayment: number; // 월 렌트비 (승계 후에도 고정, 협상 대상 아님)

  @Column({ type: 'int', nullable: true })
  remainingMonths: number;

  @Column({ type: 'int', nullable: true })
  totalMonths: number;

  @Column({ type: 'bigint', nullable: true })
  totalTakeoverCost: number; // 총 인수 비용(보증금 등)

  @Column({ type: 'bigint', nullable: true })
  totalRemainingPayment: number; // 승계 후 총 납입 예정금액(참고용, monthlyPayment*remainingMonths 근사)

  @Column({ type: 'bigint', nullable: true })
  maxSubsidy: number; // 차주가 제시하는 최대 승계지원금(참고 상한선, 강제 아님)

  @Column({ type: 'bigint', default: 0 })
  returnFeeAtEnd: number; // 만기 후 반납 시 비용

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'text', nullable: true })
  insuranceNote: string;

  @Column({ type: 'json', nullable: true })
  options: string[];

  @Column({ type: 'json', nullable: true })
  photos: Record<string, string[]>;

  @Column({ nullable: true })
  sellerName: string;

  @Column({ nullable: true })
  sellerContact: string;

  @Column({ default: 'active' })
  status: string; // 'active' | 'matched' | 'completed' | 'hidden'

  @Column({ type: 'varchar', nullable: true, unique: true })
  ownerAccessToken: string | null;

  @Column({ type: 'int', nullable: true })
  winningBidId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  matchedAt: Date;

  @CreateDateColumn()
  registeredAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
