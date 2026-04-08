import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 구매자 대행 서비스 신청 엔티티
 * - 구매자가 차량을 구매하기 위해 카비어 평가사 대행을 신청하는 테이블
 * - 판매자(Booking) 전용 테이블과 분리
 */
@Entity('buyer_requests')
export class BuyerRequest {
  @PrimaryGeneratedColumn()
  id: number;

  /** 처리 상태: PENDING → CONSULTING → ASSIGNED → COMPLETED / CANCELLED */
  @Column({ default: 'PENDING' })
  status: string;

  /** 신청자(구매자) 성명 */
  @Column()
  buyerName: string;

  /** 구매자 연락처 */
  @Column()
  contact: string;

  /** 차량 위치 (판매자 주소 - 평가사 방문 장소) */
  @Column()
  address: string;

  /** 상세 주소 */
  @Column({ nullable: true })
  detailAddress: string;

  /** 방문 희망 일시 (예: 2026-04-15 14:00) */
  @Column()
  preferredDateTime: string;

  /** 구매 희망 가격 범위 (예: 1500~2000만원) */
  @Column({ nullable: true })
  desiredPrice: string;

  /** 구매 차량 정보 및 요청사항 */
  @Column({ type: 'text', nullable: true })
  additionalMemo: string;

  /** 유입 채널 (KARROT_FORM / PRIVATE_DEAL_FORM / META / YOUTUBE 등) */
  @Column({ default: 'PRIVATE_DEAL_FORM' })
  source: string;

  /** 개인정보 수집 동의 여부 */
  @Column({ default: false })
  privacyAgreed: boolean;

  /** 배정된 진단사 ID */
  @Column({ nullable: true })
  assignedDriverId: string | null;

  /** 배정된 진단사 이름 */
  @Column({ nullable: true })
  assignedDriverName: string | null;

  /** 관리자 메모 */
  @Column({ type: 'text', nullable: true })
  adminMemo: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
