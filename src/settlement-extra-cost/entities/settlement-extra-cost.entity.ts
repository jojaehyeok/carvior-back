import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, Unique } from 'typeorm';

// 발주사 월별 정산 화면(chavata-dashboard src/pages/store/settlement.tsx)의 "기타비용" —
// 예전엔 페이지 안의 useState로만 있어서 새로고침하거나 다시 조회하면 항상 0으로 초기화됐음.
// 발주사(source)+정산월 조합당 하나의 값만 유지하면 되므로 이 테이블에 저장한다.
@Entity('settlement_extra_costs')
@Unique(['source', 'month'])
export class SettlementExtraCost {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  source: string;

  // 'YYYY-MM' 형식
  @Column()
  month: string;

  @Column({ type: 'bigint', default: 0 })
  amount: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
