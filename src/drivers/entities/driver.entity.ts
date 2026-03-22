import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('drivers')
export class Driver {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  accountId: string; // 로그인 아이디

  @Column()
  password: string; // 비밀번호 (해싱 필요)

  @Column()
  name: string;

  @Column({ unique: true })
  phone: string;

  @Column({ nullable: true })
  region: string | null;

  @Column({ nullable: true })
  experience: string | null;

  @Column({ nullable: true })
  licenseImageUrl: string | null;

  @Column({ default: 'PENDING' })
  status: 'PENDING' | 'APPROVED' | 'REJECTED';

  @CreateDateColumn()
  createdAt: Date;
}