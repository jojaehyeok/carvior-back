import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// 진단사 폰이 원격이라 직접 로그를 확인할 수 없을 때를 위한 클라이언트 에러 리포트 —
// ChavatarApp의 catch 블록에서 서버로 전송해 관리자가 원격으로 확인 가능하게 함
@Entity('client_error_logs')
export class ClientErrorLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', nullable: true })
  driverId: string | null;

  @Column({ type: 'varchar', nullable: true })
  driverName: string | null;

  @Column()
  screen: string; // 어느 화면에서 발생했는지 (예: 'my-schedule')

  @Column({ type: 'text' })
  message: string;

  @CreateDateColumn()
  createdAt: Date;
}
