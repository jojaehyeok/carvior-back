import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// 차량판매중개 시스템의 "차량 정체성" 앵커. 기존 코드베이스엔 Vehicle 개념이 없어서
// Inspection/Booking/StoreItem이 각자 carNumber 문자열만 따로 들고 있었음 — 이 엔티티가
// 그걸 하나로 묶는 최초의 지점. 같은 차량번호로 여러 번 검차해도 Vehicle row는 하나만 유지.
//
// 가장 중요한 원칙(요청 검차 신청자 ≠ 실제 차주일 수 있음):
// requesterName/requesterContact = 검차를 "신청한" 사람(제3의 구매예정자일 수도 있음)
// ownerName/ownerContact = 실제 차량 소유자(운영자가 확인해서 채움, 신청자와 다를 수 있음)
@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  carNumber: string;

  // 이 차량에 대해 가장 최근에 완료된 진단 — 목록 화면에서 빠르게 참조하는 용도(캐시성),
  // 최종 근거는 항상 inspections 테이블 조회.
  @Column({ type: 'int', nullable: true })
  latestInspectionId: number | null;

  // 검차 신청자(구매예정자일 수도, 차주 본인일 수도) — 최초 검차 완료 시점의 Booking에서 스냅샷
  @Column({ nullable: true })
  requesterName: string | null;

  @Column({ nullable: true })
  requesterContact: string | null;

  // 실제 차주 — 운영자가 확인 후 채움. Booking.customerContact가 있으면 최초값으로 시딩되지만,
  // 신청자가 곧 차주가 아닌 경우엔 운영자가 미매칭 관리 화면에서 직접 조사해서 입력해야 함.
  @Column({ nullable: true })
  ownerName: string | null;

  @Column({ nullable: true })
  ownerContact: string | null;

  // 실제 차주가 로그인 계정을 갖고 있으면 연결(느슨한 연결, FK 제약 없음 — 이 프로젝트 관례와 동일)
  @Column({ type: 'int', nullable: true })
  ownerUserId: number | null;

  // 검차 신청자가 곧 실제 차주였는지 여부 — 운영자가 확인 전까지는 null(모름).
  @Column({ type: 'boolean', nullable: true })
  requesterIsOwner: boolean | null;

  // NONE(검차 이력 없음) | UNMATCHED_INSPECTED(검차완료, 판매전환 전) |
  // OWNER_CONTACT_PENDING | OWNER_CONTACTED | OWNER_DECLINED_TO_SELL | OWNER_AGREED_TO_SELL |
  // LISTED(SaleListing 생성됨)
  @Column({ default: 'NONE' })
  saleStatus: string;

  @Column({ type: 'timestamp', nullable: true })
  ownerContactedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  ownerRespondedAt: Date | null;

  // 운영자가 차주와 연락하며 남기는 메모(연락 채널, 협의 내용 등)
  @Column({ type: 'text', nullable: true })
  adminMemo: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
