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
}