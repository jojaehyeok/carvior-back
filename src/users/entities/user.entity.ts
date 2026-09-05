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

  @Column({ type: 'varchar', nullable: true })
  profileImage: string | null;

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

  // 매입팀 전용 계정 — 대시보드 진단 목록에서 매입 판단에 필요한 컬럼만 남기고 나머지를 숨긴다.
  // (배정/계약서/등록증 같은 운영 컬럼은 매입팀 업무와 무관해서 화면만 복잡해짐)
  @Column({ default: false })
  isPurchaseTeam: boolean;

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

  // 딜바타(딜러 앱) 푸쉬 알림용 — drivers.pushToken과 동일 패턴(Expo/FCM 토큰 그대로 저장)
  @Column({ type: 'varchar', nullable: true })
  pushToken: string | null;

  // 관리자 대시보드(웹 브라우저) 푸시용 FCM 토큰. 위 pushToken(앱)과는 발송 규격이 달라서
  // (앱은 android 채널/소리, 웹은 webpush 아이콘/클릭 링크) 컬럼을 분리한다.
  // 브라우저·기기마다 토큰이 달라서 마지막에 권한을 허용한 곳 하나만 유지된다 —
  // 여러 기기에서 동시에 받아야 하면 별도 테이블로 빼야 한다.
  @Column({ type: 'varchar', length: 512, nullable: true })
  webPushToken: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
