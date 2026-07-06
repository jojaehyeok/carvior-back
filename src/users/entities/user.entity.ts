import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, nullable: true })
  email: string;

  @Column({ nullable: true, select: false })
  password: string;

  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  provider: string; // 'local' | 'kakao' | 'naver'

  @Column({ nullable: true })
  providerId: string;

  @Column({ nullable: true })
  profileImage: string;

  @Column({ default: 'user' })
  role: string; // 'user' | 'dealer' | 'admin'

  // 딜러 전용 서류
  @Column({ nullable: true })
  dealerLicenseUrl: string; // 자동차 매매종사원증

  @Column({ nullable: true })
  businessRegUrl: string; // 사업자등록증

  @Column({ nullable: true })
  businessNumber: string; // 사업자번호

  @Column({ nullable: true })
  companyName: string; // 상호명

  @Column({ default: 'none' })
  dealerStatus: string; // 'none' | 'pending' | 'approved' | 'rejected'

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
