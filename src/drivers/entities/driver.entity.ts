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

  @Column() // 비번은 필수
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