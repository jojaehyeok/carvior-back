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

  // 자동배정 알고리즘이 어떤 후보들을 비교해서 왜 이 진단사를 골랐는지 기록 —
  // 수동 배정 건은 null(대시보드 UI에서 "수동 배정"으로 표시), SUPER_ADMIN 전용 확인용
  @Column({ type: 'simple-json', nullable: true })
  autoAssignLog: Record<string, unknown> | null;
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

  @Column({ default: false })
  privacyAgreed: boolean;

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
  isOldDealerPurchase: boolean; // (구) 구전 매입 여부 — oldDealerFee(금액 입력)로 대체, 컬럼은 하위호환용으로 유지

  @Column({ type: 'int', nullable: true })
  oldDealerFee: number | null; // 구전 금액 (만원) — 예/아니오 대신 실제 지급액을 기록

  // 계약팀이 오더 진행 중 직접 확인·기록하는 고객(차주) 연락처 — 접수 시 받는
  // contact는 신청자(딜러/고객) 번호라 실제 차주 번호와 다를 수 있어 별도 필드로 관리
  @Column({ type: 'varchar', nullable: true })
  customerContact: string | null;
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