import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 신고 — 개인 직거래에서 허위매물·사기·욕설을 운영이 사람 손으로 걸러내기 위한 기록.
 *
 * 자동으로 매물을 내리지 않는다. 신고 한 건으로 매물이 사라지면 경쟁 판매자가
 * 신고만으로 남의 매물을 내릴 수 있다 — 반드시 관리자가 보고 판단한다.
 */
@Entity('reports')
@Index(['targetType', 'targetId'])
@Index(['status', 'id'])
export class Report {
  @PrimaryGeneratedColumn()
  id: number;

  // 신고한 사람(users.id)
  @Column()
  reporterUserId: number;

  // listing: 매물 / chat: 대화방(상대방) — 둘 다 결국 사람을 보는 거라 대상은 같이 적어둔다
  @Column({ type: 'varchar' })
  targetType: 'listing' | 'chat';

  @Column()
  targetId: number;

  // 신고 대상 매물(대화 신고일 때도 어떤 매물의 대화인지 남긴다) — 관리자 화면에서 바로 열어보게
  @Column({ type: 'int', nullable: true })
  storeItemId: number | null;

  // 신고당한 사람(users.id). 매물 주인이 없는 등 알 수 없으면 비워둔다
  @Column({ type: 'int', nullable: true })
  targetUserId: number | null;

  // fake(허위매물) / price(가격 불일치) / dealer(개인인 척하는 딜러) / fraud(사기 의심)
  // / abuse(욕설·협박) / spam(광고·도배) / other(기타)
  @Column({ type: 'varchar' })
  reason: string;

  @Column({ type: 'text', nullable: true })
  detail: string | null;

  // pending: 접수 / resolved: 조치함 / dismissed: 문제없음
  @Column({ type: 'varchar', default: 'pending' })
  status: 'pending' | 'resolved' | 'dismissed';

  // 처리 내용과 처리한 관리자 아이디 — 나중에 "누가 왜 내렸냐"를 답할 수 있어야 한다
  @Column({ type: 'text', nullable: true })
  adminNote: string | null;

  @Column({ type: 'varchar', nullable: true })
  handledBy: string | null;

  @Column({ type: 'timestamp', nullable: true })
  handledAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
