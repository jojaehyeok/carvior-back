import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, nullable: true })
  email: string;

  @Column({ nullable: true, select: false })
  password: string;

  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  provider: string; // 'local' | 'kakao' | 'naver'

  @Column({ nullable: true })
  providerId: string;

  @Column({ nullable: true })
  profileImage: string;

  @Column({ default: 'user' })
  role: string; // 'user' | 'dealer' | 'admin'

  // role='admin'인 경우: null이면 SUPER_ADMIN(전체 조회), 값이 있으면 COMPANY_ADMIN
  // (chavata-dashboard 로그인 시 그 발주사 소속 의뢰만 보임 — booking.source와 매칭)
  @Column({ nullable: true })
  company: string | null;

  // 딜러 전용 서류
  @Column({ nullable: true })
  dealerLicenseUrl: string; // 자동차 매매종사원증

  @Column({ nullable: true })
  businessRegUrl: string; // 사업자등록증

  @Column({ nullable: true })
  businessNumber: string; // 사업자번호

  @Column({ nullable: true })
  companyName: string; // 상호명

  @Column({ default: 'none' })
  dealerStatus: string; // 'none' | 'pending' | 'approved' | 'rejected'

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
