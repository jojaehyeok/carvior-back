import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// 딜러앱 스마트옥션 — 낙찰 후 2시간 이내 "견적 재확인"을 안 하거나, 그 외 운영 룰 위반 시
// 일정 기간 입찰을 막는 페널티. driver-assignment-penalties와 동일 패턴.
@Entity('dealer_penalties')
export class DealerPenalty {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  dealerId: number;

  @Column({ nullable: true })
  storeItemId: number;

  @Column({ default: 'unconfirmed_winner' })
  reason: string; // 'unconfirmed_winner' | 'manual' 등

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp' })
  expiresAt: Date;
}
