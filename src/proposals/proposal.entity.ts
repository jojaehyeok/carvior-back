import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('proposals')
export class Proposal {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  storeItemId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  company: string;

  @Column()
  contact: string;

  @Column({ type: 'float', nullable: true })
  proposedUSD: number;

  @Column({ type: 'text', nullable: true })
  message: string;

  @Column({ default: 'pending' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;
}
