// driver.entity.ts 수정본
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('drivers')
export class Driver {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  accountId: string;

  @Column() // 비번은 필수
  password: string;

  @Column()
  name: string;

  @Column({ unique: true })
  phone: string;

  // 🚀 수정 포인트: 타입을 string으로 고정하고 nullable 설정만 둡니다.
  @Column({ type: 'varchar', nullable: true }) 
  region: string; 

  @Column({ type: 'text', nullable: true }) 
  experience: string;

  @Column({ type: 'varchar', nullable: true })
  licenseImageUrl: string;

  @Column({ type: 'varchar', nullable: true })
  pushToken: string;

  @Column({ default: 'PENDING' })
  status: 'PENDING' | 'APPROVED' | 'REJECTED';

  @CreateDateColumn()
  createdAt: Date;
}