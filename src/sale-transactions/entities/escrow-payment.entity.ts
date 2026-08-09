import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// 카비어가 직접 돈을 보관하지 않는다는 원칙(스펙 7번, 절대 금지사항)을 지키기 위해
// PG/에스크로 사업자 연동을 이 테이블 하나로 추상화한다. 지금은 pgProvider='mock'
// (MockEscrowProvider)만 있고, 12단계에서 실제 사업자로 교체될 자리.
@Entity('escrow_payments')
export class EscrowPayment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  transactionId: number;

  @Column({ default: 'mock' })
  pgProvider: string;

  @Column({ type: 'varchar', nullable: true })
  pgTransactionId: string | null;

  @Column({ type: 'bigint' })
  amount: number;

  // PAYMENT_PENDING | PAID_TO_ESCROW | RELEASE_REQUESTED | RELEASED | CANCELLED | REFUNDED
  @Column({ default: 'PAYMENT_PENDING' })
  escrowStatus: string;

  @CreateDateColumn()
  requestedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  releasedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  failedAt: Date | null;
}
