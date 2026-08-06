import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// 파트너패널(발주사 전용 관리페이지) 제휴 신청 — /marketing/partner-panel에서 접수.
// 개별건 검차를 10회 이상 이용한 고객에게만 노출되는 제안이라, 신청 시점의 자격(검증된 건수)도 같이 남긴다.
@Entity('partner_applications')
export class PartnerApplication {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  phone: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  companyName: string;

  @Column({ type: 'text', nullable: true })
  message: string;

  @Column({ type: 'int', default: 0 })
  qualifyingCount: number; // 신청 시점에 확인된 개별 완료건수

  @Column({ default: 'pending' })
  status: string; // 'pending' | 'approved' | 'rejected'

  @CreateDateColumn()
  createdAt: Date;
}
