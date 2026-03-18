import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('bookings')
export class Booking {
    @PrimaryGeneratedColumn()
    id: number;

  @Column({ default: 'PENDING' }) // 접수 상태값 추가
  status: string;

  @Column()
  carNumber: string;

  @Column()
  carOwner: string;

  @Column()
  dealerName: string;

  @Column()
  contact: string;

  @Column()
  address: string;

  @Column({ nullable: true })
  detailAddress: string;

  @Column()
  preferredDateTime: string; // "2026-03-20 14:00" 형식

  @Column({ type: 'text', nullable: true })
  additionalMemo: string;

  @Column({ default: 'SNS_PROMOTION' })
  source: string;

  @CreateDateColumn()
  createdAt: Date;
}