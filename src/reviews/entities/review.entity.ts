import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  bookingId: number;

  @Column({ nullable: true })
  driverId: string;

  @Column({ nullable: true })
  driverName: string;

  @Column({ nullable: true })
  carNumber: string;

  @Column({ nullable: true })
  carOwner: string;

  @Column({ type: 'tinyint' })
  rating: number; // 1~5

  @Column({ type: 'text', nullable: true })
  comment: string;

  @Column({ type: 'json', nullable: true })
  photoUrls: string[];

  @CreateDateColumn()
  createdAt: Date;
}
