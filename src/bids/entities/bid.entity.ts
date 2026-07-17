import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('bids')
export class Bid {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  storeItemId: number;

  @Column({ nullable: true })
  dealerId: number;

  @Column()
  dealerName: string;

  @Column({ type: 'bigint' })
  amount: number;

  @CreateDateColumn()
  createdAt: Date;
}
