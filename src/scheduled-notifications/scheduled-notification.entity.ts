import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// 서버가 중간에 재배포/재시작돼도 예약 발송이 유실되지 않도록 DB에 기록해두고
// 크론잡이 주기적으로 도착한 건을 찾아서 보낸다(setTimeout 방식은 재시작 시 사라짐).
@Entity('scheduled_notifications')
export class ScheduledNotification {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  type: string; // 예: 'completion_partner'

  @Column()
  recipientPhone: string;

  @Column({ type: 'json' })
  variables: Record<string, string>;

  @Column({ type: 'timestamp' })
  sendAt: Date;

  @Column({ default: false })
  sent: boolean;

  @Column({ type: 'timestamp', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
