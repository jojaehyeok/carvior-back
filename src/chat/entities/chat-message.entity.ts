import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('chat_messages')
@Index(['roomId', 'id'])
export class ChatMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  roomId: number;

  // 보낸 사람(users.id). 시스템 메시지는 0으로 둔다.
  @Column()
  senderUserId: number;

  @Column({ type: 'text' })
  text: string;

  // text: 사람이 친 말
  // system: "대화가 시작됐습니다" 같은 안내
  // inspection: 검차 제안 — 받는 쪽 화면에 신청 버튼이 같이 붙는다
  @Column({ type: 'varchar', default: 'text' })
  type: 'text' | 'system' | 'inspection';

  @CreateDateColumn()
  createdAt: Date;
}
