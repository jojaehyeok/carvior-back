// driver.entity.ts 수정본
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('drivers')
export class Driver {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  accountId: string;

  // select:false — GET /v1/drivers, /v1/drivers/:id 등 기본 조회에 절대 포함되지 않게 함
  // (이 값이 평문으로 공개 API에 그대로 노출되고 있었음, 로그인 시엔 findByAccountId에서 명시적으로 select)
  @Column({ select: false })
  password: string;

  @Column()
  name: string;

  @Column({ unique: true })
  phone: string;

  // 🚀 수정 포인트: 타입을 string으로 고정하고 nullable 설정만 둡니다.
  @Column({ type: 'varchar', nullable: true }) 
  region: string; 

  @Column({ type: 'text', nullable: true }) 
  experience: string;

  @Column({ type: 'varchar', nullable: true })
  licenseImageUrl: string;

  // 진단리포트/평가사 소개에 노출할 프로필 사진 — 관리자가 대시보드 평가사 관리에서 등록
  @Column({ type: 'varchar', nullable: true })
  photoUrl: string;

  @Column({ type: 'varchar', nullable: true })
  pushToken: string;

  @Column({ default: 'PENDING' })
  status: 'PENDING' | 'APPROVED' | 'REJECTED';

  @CreateDateColumn()
  createdAt: Date;

  // ── 가용성 (스케줄) ──────────────────────────────────
  @Column({ type: 'simple-json', nullable: true })
  regions: string[];           // ['서울', '경기']

  @Column({ type: 'simple-json', nullable: true })
  availableDays: number[];     // 0=일, 1=월 … 6=토

  @Column({ type: 'varchar', nullable: true })
  availableStartTime: string;  // '09:00'

  @Column({ type: 'varchar', nullable: true })
  availableEndTime: string;    // '18:00'

  @Column({ default: 5 })
  maxDailyBookings: number;

  @Column({ type: 'simple-json', nullable: true })
  vehicleTypes: string[];      // ['승용차', 'SUV', '트럭']

  // ── GPS 위치 ──────────────────────────────────────────
  @Column({ type: 'double', nullable: true })
  lat: number | null;

  @Column({ type: 'double', nullable: true })
  lng: number | null;

  @Column({ type: 'timestamp', nullable: true })
  lastSeenAt: Date | null;

  // 진단사 본인이 앱에서 켜고 끄는 "활동중지" 스위치 — 정해진 근무시간(availableDays/
  // availableStartTime/EndTime) 안이라도 이걸 꺼두면 자동배정·신규접수 브로드캐스트 둘 다
  // 제외됨(원거리 이동 중 휴대폰을 꺼두는 경우 등, 스케줄만으로는 못 막는 공백 대응)
  @Column({ default: true })
  isActive: boolean;

  // 등급제 — 'general'(일반, ~5만원) | 'certified'(진단평가사, ~6만원, 라운딩 부담) |
  // 'agent'(에이전트, 6.5~8만원 협의) — agent는 다른 진단사에게 건을 지정 배정하고
  // 그 건의 리포트를 대신 수정할 수 있음
  @Column({ default: 'general' })
  tier: 'general' | 'certified' | 'agent';
}