import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * 개인 직거래 매물 하나에 대한 구매자-판매자 1:1 대화방.
 *
 * 매물×구매자 조합마다 방이 하나 생긴다(판매자는 매물 주인이라 자동으로 정해진다).
 * 같은 사람이 같은 매물을 다시 눌러도 기존 방을 다시 열어준다.
 */
@Entity('chat_rooms')
@Index(['storeItemId', 'buyerUserId'], { unique: true })
export class ChatRoom {
  @PrimaryGeneratedColumn()
  id: number;

  // 어떤 매물에 대한 대화인지 (store_items.id)
  @Column()
  storeItemId: number;

  // 문의를 건 사람(구매자)
  @Column()
  buyerUserId: number;

  // 매물을 올린 사람(판매자)
  @Column()
  sellerUserId: number;

  // 목록 정렬용 — 마지막 메시지가 온 시각
  @Column({ type: 'timestamp', nullable: true })
  lastMessageAt: Date | null;

  // 목록에서 미리보기로 보여줄 마지막 메시지(메시지 테이블을 다시 안 읽어도 되게)
  @Column({ type: 'varchar', nullable: true })
  lastMessageText: string | null;

  // 각자 마지막으로 읽은 시각 — 안 읽은 개수는 이 시각 이후 메시지 수로 센다
  @Column({ type: 'timestamp', nullable: true })
  buyerReadAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  sellerReadAt: Date | null;

  // active: 대화중 / closed: 거래 끝남 / blocked: 신고·차단
  @Column({ type: 'varchar', default: 'active' })
  status: 'active' | 'closed' | 'blocked';

  // 차단한 사람(users.id) — 차단을 푸는 건 차단한 쪽만 할 수 있어야 한다
  @Column({ type: 'int', nullable: true })
  blockedByUserId: number | null;

  // 거래완료 시각(거래완료는 판매자가 누른다)
  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  // closed가 된 이유. completed: 이 사람과 거래가 끝났다 / sold_elsewhere: 판매자가
  // 다른 사람과 거래를 끝내서 같이 닫혔다.
  // ⚠ 후기는 completed인 방에서만 쓸 수 있다 — 구분이 없으면 거래하지 않은 사람도 별점을 준다.
  @Column({ type: 'varchar', nullable: true })
  closedReason: 'completed' | 'sold_elsewhere' | null;

  @CreateDateColumn()
  createdAt: Date;
}
