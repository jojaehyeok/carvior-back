import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// 발주사 계정이 직접 트리거해서 실제 SMS 비용이 나가는 액션을 과금 대상으로 기록하는 장부.
// 실제 결제/차감은 하지 않고 회사별 누적 금액만 쌓아서 대시보드에서 수동 청구 참고용으로 씀.
// 원가(SMS 단문 13원)보다 마진 붙여 50원으로 청구.
@Entity('sms_billing_logs')
export class SmsBillingLog {
  @PrimaryGeneratedColumn()
  id: number;

  // 예약의 source(발주사 코드, 예: anyone-motors) — 없으면 어느 회사 소속인지 알 수 없는 건
  @Column({ nullable: true })
  source: string;

  @Column()
  bookingId: number;

  @Column({ nullable: true })
  carNumber: string;

  // 이 SMS를 받은 사람의 연락처 — 어느 건/누구에게 나간 과금인지 장부에서 바로 식별하기 위함
  @Column({ nullable: true })
  recipientContact: string;

  // 받는 사람 구분 — 'dealer'(수정요청은 진단사/매니저지만 편의상 여기 기록) / 'customer'
  @Column({ nullable: true })
  recipient: string;

  // 과금 사유 — 'request-update'(진단사/매니저 수정 요청) / 'registration-send'(이전 등록증 전송)
  @Column()
  purpose: string;

  @Column({ default: 50 })
  amount: number;

  @CreateDateColumn()
  createdAt: Date;
}
