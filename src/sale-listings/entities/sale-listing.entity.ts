import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// 차주 판매동의(Vehicle.saleStatus === 'OWNER_AGREED_TO_SELL')를 받은 차량에 대해서만 생성됨.
// 검차 리포트는 복사하지 않고 inspectionId로 참조만 한다 — 리포트를 고치면 여기서도 항상
// 최신값을 보게 하려는 의도(스펙 3번 원칙).
@Entity('sale_listings')
export class SaleListing {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  vehicleId: number;

  // 매물 생성 시점의 Vehicle.latestInspectionId 스냅샷 — 검차 데이터 자체는 여기 복사 안 하고
  // 항상 inspections 테이블을 이 id로 조회해서 참조한다.
  @Column({ type: 'int', nullable: true })
  inspectionId: number | null;

  // 차주가 로그인 계정을 갖고 있으면 연결(느슨한 연결, 이 프로젝트 관례와 동일 — FK 제약 없음)
  @Column({ type: 'int', nullable: true })
  ownerId: number | null;

  // 이 매물은 차주 동의 없이는 만들어질 수 없으므로 항상 true로 생성되지만,
  // 감사(audit) 목적으로 명시적으로 남겨둔다.
  @Column({ default: true })
  ownerConsent: boolean;

  @Column({ type: 'bigint' })
  askingPrice: number;

  @Column({ type: 'bigint', nullable: true })
  minimumAcceptablePrice: number | null;

  // ACTIVE(입찰중) | TARGET_PRICE_MET(희망가 이상 입찰 존재, 자동낙찰 아님) |
  // AWARDED(차주가 최종 승인) | CLOSED(입찰기간 종료, 낙찰자 없음) | CANCELLED
  @Column({ default: 'ACTIVE' })
  listingStatus: string;

  @Column({ type: 'timestamp', nullable: true })
  biddingStartAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  biddingEndAt: Date | null;

  // 딜러 경쟁입찰 기능(5단계)에서 채워짐 — 지금은 컬럼만 미리 마련
  @Column({ type: 'int', nullable: true })
  winningBidId: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
