import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// 자동배정으로 받은 건을 관리자가 다른 진단사에게 수동으로 넘긴 경우, 원래 받았던
// 진단사에게 7일간 자동배정 로드밸런싱 집계에서 +1 가상 건수 페널티를 준다(공지 참고:
// "자동배정 건을 다른 진단사에게 넘긴 경우" 룰). expiresAt 이전 행만 유효한 페널티로 집계한다.
@Entity('driver_assignment_penalties')
export class DriverAssignmentPenalty {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  driverId: string;

  @Column({ nullable: true })
  bookingId: number;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp' })
  expiresAt: Date;
}
