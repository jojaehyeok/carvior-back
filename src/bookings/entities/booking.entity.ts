import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ default: 'PENDING' })
  status: string;

  // --- 진단사 배정 관련 컬럼 추가 ---
  @Column({ type: 'varchar', nullable: true })
  assignedDriverId: string | null;

  @Column({ type: 'varchar', nullable: true })
  assignedDriverName: string | null;
  // ------------------------------

  @Column()
  carNumber: string;

  @Column({ nullable: true })
  carOwner: string;

  @Column({ nullable: true })
  dealerName: string;

  @Column()
  contact: string;

  @Column()
  address: string;

  @Column({ nullable: true })
  detailAddress: string;

  @Column()
  preferredDateTime: string;

  @Column({ nullable: true })
  desiredPrice: string;

  @Column({ type: 'text', nullable: true })
  additionalMemo: string;

  @Column({ default: 'SNS_PROMOTION' })
  source: string;

  // --- 오더 기록 필드 ---
  @Column({ nullable: true })
  contractWriter: string; // 계약서 작성자

  @Column({ default: false })
  vehicleTransferred: boolean; // 차량 이전 여부

  @Column({ type: 'int', nullable: true })
  purchasePrice: number | null; // 매입가 (만원)

  @Column({ default: false })
  isOldDealerPurchase: boolean; // 구전 매입 여부
  // ----------------------

  @Column({ type: 'text', nullable: true })
  adminMemo: string;

  // 진단사 취소로 재대기 전환된 시각 (null이면 일반 PENDING)
  @Column({ type: 'timestamp', nullable: true })
  cancelledByDriverAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}