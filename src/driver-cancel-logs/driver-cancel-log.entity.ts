import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('driver_cancel_logs')
export class DriverCancelLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  driverId: string;

  @Column()
  driverName: string;

  @Column()
  bookingId: number;

  @Column({ nullable: true })
  carNumber: string;

  @Column({ nullable: true })
  carOwner: string;

  @Column({ nullable: true })
  cancelReason: string;

  @CreateDateColumn()
  createdAt: Date;
}
