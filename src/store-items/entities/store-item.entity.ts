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

  // 차주가 로그인 없이 입찰현황을 확인하는 페이지용 토큰 — 경매 시작(active 전이) 시 생성.
  @Column({ type: 'varchar', nullable: true, unique: true })
  ownerAccessToken: string | null;

  // 낙찰 이후 세부 진행단계. status(active/sold/hidden/pending/closed)와 별개로 관리.
  @Column({ default: 'bidding' })
  saleStage: string; // 'bidding' | 'winner_selected' | 'in_transit' | 'transit_done' | 'completed'

  @Column({ type: 'int', nullable: true })
  winningBidId: number | null;

  // 낙찰 딜러가 입금한 차대금을 관리자가 육안으로 확인했는지 여부.
  // winner_selected → in_transit 전환 게이트 (bookings 모듈의 depositConfirmed와 같은 수동확인 패턴).
  @Column({ default: false })
  depositConfirmed: boolean;

  @Column({ type: 'timestamp', nullable: true })
  depositConfirmedAt: Date | null;

  // 차주가 "판매요청" 버튼으로 고른 입찰 — 확정 아님, 관리자 알림용 (실제 확정은 selectWinner)
  @Column({ type: 'int', nullable: true })
  ownerRequestedBidId: number | null;

  @Column({ type: 'timestamp', nullable: true })
  ownerRequestedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  winnerSelectedAt: Date;

  // 낙찰 딜러가 "책임질 수 있는 견적입니다"를 눌러 확인한 시각 — 낙찰 후 2시간 이내 미확인 시 페널티 대상
  @Column({ type: 'timestamp', nullable: true })
  winnerConfirmedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  inTransitAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  transitDoneAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date;

  // 경매마감 알림 크론이 이미 발송했는지 (중복발송 방지용 dedup 키)
  @Column({ type: 'timestamp', nullable: true })
  deadlineNotifiedAt: Date;

  // 명의이전 완료 후 등록증 사진 URL
  @Column({ type: 'varchar', nullable: true })
  transferredRegistrationUrl: string | null;

  @CreateDateColumn()
  registeredAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
