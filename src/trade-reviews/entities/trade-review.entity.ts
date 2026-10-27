import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 거래 후기 — 거래완료된 대화방에서 서로에게 한 번씩 남긴다.
 *
 * 개인 직거래는 상대가 어떤 사람인지가 전부라, 후기가 쌓이는 만큼 안전해진다.
 * 거래가 끝나지 않은 방에서는 남길 수 없다(싸우고 나서 별 하나 주는 걸 막는다).
 */
@Entity('trade_reviews')
@Index(['roomId', 'reviewerUserId'], { unique: true })
@Index(['targetUserId'])
export class TradeReview {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  roomId: number;

  @Column()
  storeItemId: number;

  // 후기를 쓴 사람
  @Column()
  reviewerUserId: number;

  // 후기를 받은 사람(상대방)
  @Column()
  targetUserId: number;

  // 1~5
  @Column({ type: 'tinyint' })
  rating: number;

  @Column({ type: 'varchar', length: 300, nullable: true })
  text: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
