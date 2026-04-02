import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ default: 'PENDING' })
  status: string;

  // --- 진단사 배정 관련 컬럼 추가 ---
  @Column({ nullable: true })
  assignedDriverId: string; // 진단사 고유 ID (알림톡 보낼 때 필요)

  @Column({ nullable: true })
  assignedDriverName: string; // 진단사 이름 (화면 표시용)
  // ------------------------------

  @Column()
  carNumber: string;

  @Column()
  carOwner: string;

  @Column()
  dealerName: string;

  @Column()
  contact: string;

  @Column()
  address: string;

  @Column({ nullable: true })
  detailAddress: string;

  @Column()
  preferredDateTime: string;

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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}