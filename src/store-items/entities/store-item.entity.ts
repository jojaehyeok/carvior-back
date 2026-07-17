import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('store_items')
export class StoreItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'bigint', nullable: true })
  bookingId: number;

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
  displacement: string;

  @Column({ nullable: true })
  transmission: string;

  @Column({ nullable: true })
  color: string;

  @Column({ nullable: true })
  colorKo: string;

  @Column({ default: false })
  accident: boolean;

  @Column({ type: 'bigint', nullable: true })
  priceKRW: number;

  @Column({ nullable: true })
  priceUSD: number;

  @Column({ nullable: true })
  category: string;

  @Column({ nullable: true })
  region: string;

  @Column({ default: false })
  hasReport: boolean;

  @Column({ nullable: true })
  location: string;

  @Column({ nullable: true })
  doors: number;

  @Column({ nullable: true })
  seats: number;

  @Column({ nullable: true })
  inspectedAt: string;

  @Column({ default: 'active' })
  status: string;

  @Column({ default: false })
  hidePrice: boolean;

  @Column({ type: 'json', nullable: true })
  photos: Record<string, string[]>;

  @Column({ type: 'json', nullable: true })
  specs: { label: string; value: string }[];

  @Column({ type: 'json', nullable: true })
  options: string[];

  @Column({ type: 'text', nullable: true })
  adminMemo: string;

  @Column({ type: 'int', default: 0 })
  views: number;

  @Column({ type: 'int', default: 0 })
  likes: number;

  @Column({ nullable: true })
  userId: number;

  @Column({ nullable: true })
  sellerName: string;

  @Column({ nullable: true })
  sellerContact: string;

  // 진단(bookingId) 연계 없이 판매자가 직접 등록한 매물인지 여부.
  // true면 findAll()의 자동게시 로직(진단완료 기준)을 타지 않고 등록 즉시 경매가 시작됨.
  @Column({ default: false })
  selfRegistered: boolean;

  // 경매 시작/마감 시각 — 자동게시(또는 관리자 등록) 시점에 세팅.
  // 마감은 기본 48시간, 그 구간에 주말(토/일)이 걸치면 72시간으로 자동 연장.
  @Column({ type: 'timestamp', nullable: true })
  auctionStartAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  auctionEndAt: Date;

  @CreateDateColumn()
  registeredAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
