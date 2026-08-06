import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// 렌트 승계 역경매 입찰 — requestedSubsidy가 낮을수록(=승계자가 적게 받아도 되겠다고 할수록) 유리.
@Entity('rental_bids')
export class RentalBid {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  rentalListingId: number;

  @Column({ nullable: true })
  bidderId: number;

  @Column()
  bidderName: string;

  @Column({ nullable: true })
  bidderContact: string;

  @Column({ type: 'bigint' })
  requestedSubsidy: number; // 승계자가 요청하는 지원금 — 낮을수록 유리

  @CreateDateColumn()
  createdAt: Date;
}
