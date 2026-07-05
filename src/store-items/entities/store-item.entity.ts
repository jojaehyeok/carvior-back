import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('store_items')
export class StoreItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  bookingId: number;

  @Column({ nullable: true })
  carNumber: string;

  @Column({ nullable: true })
  titleKo: string;

  @Column({ nullable: true })
  titleEn: string;

  @Column({ nullable: true })
  trim: string;

  @Column({ nullable: true })
  year: number;

  @Column({ nullable: true })
  mileage: number;

  @Column({ nullable: true })
  fuel: string;

  @Column({ nullable: true })
  displacement: string;

  @Column({ nullable: true })
  transmission: string;

  @Column({ nullable: true })
  color: string;

  @Column({ nullable: true })
  colorKo: string;

  @Column({ default: false })
  accident: boolean;

  @Column({ type: 'bigint', nullable: true })
  priceKRW: number;

  @Column({ nullable: true })
  priceUSD: number;

  @Column({ nullable: true })
  category: string;

  @Column({ nullable: true })
  region: string;

  @Column({ default: false })
  hasReport: boolean;

  @Column({ nullable: true })
  location: string;

  @Column({ nullable: true })
  doors: number;

  @Column({ nullable: true })
  seats: number;

  @Column({ nullable: true })
  inspectedAt: string;

  @Column({ default: 'active' })
  status: string;

  @Column({ default: false })
  hidePrice: boolean;

  @Column({ type: 'json', nullable: true })
  photos: Record<string, string[]>;

  @Column({ type: 'json', nullable: true })
  specs: { label: string; value: string }[];

  @Column({ type: 'json', nullable: true })
  options: string[];

  @Column({ type: 'text', nullable: true })
  adminMemo: string;

  @CreateDateColumn()
  registeredAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
