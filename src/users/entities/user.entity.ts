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
  @Column({ type: 'varchar', nullable: true })
  company: string | null;

  // 발주사 관리자 계정 전용 — 대시보드 로그인 시 사이드바 로고를 자사 로고로 대체(화이트라벨)
  @Column({ type: 'varchar', nullable: true })
  logoUrl: string | null;

  // 발주사 관리자 계정 전용 — datrade처럼 수출용 차량만 다루는 발주사인지 표시.
  // true면 그 발주사(company) source로 들어오는 예약은 진단사 앱에 "수출건"으로 표시되고,
  // 진단 화면에 수출용 영상 촬영 슬롯이 노출된다.
  @Column({ default: false })
  isExportOnly: boolean;

  // 발주사 관리자 계정 전용 — 같은 회사(company) 소속 관리자가 여러 명일 때, 매입가/구전
  // 확인·미확인 토글을 이 계정만 할 수 있게 제한한다(예: 사무장 전담). false면 조회만 가능.
  @Column({ default: false })
  canConfirmBilling: boolean;

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

  // 광고성 정보 수신 동의 — 정보통신망법상 별도 opt-in, 가입 시 기본 미동의
  @Column({ default: false })
  marketingConsent: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
