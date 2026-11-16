import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 파트너(상사) API 클라이언트.
 *
 * 전에는 애니원모터스 한 곳뿐이라 client_id/secret을 .env에 두고 있었다
 * (ANYONE_MOTORS_CLIENT_ID/SECRET). 상사 통합관리 프로그램을 여러 상사가 쓰게 되면서
 * 상사마다 열쇠가 필요해졌고, 상사가 늘 때마다 .env를 고치고 서버를 재시작하는 건
 * 가입 흐름으로 만들 수 없어서 테이블로 옮긴다.
 *
 * .env 방식은 한 배포 주기 동안 함께 살려둔다(발급 엔드포인트의 폴백) — 애니원 쪽
 * 서버가 이미 그 열쇠로 돌고 있어서, 테이블로 옮기자마자 끊기면 매입 내역 가져오기가 멈춘다.
 */
@Entity()
export class PartnerClient {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * 상사 코드. 세 곳에서 **같은 값**이어야 한다 —
   *   ① booking.source (접수 출처)
   *   ② 상사 프로그램 서브도메인 `{code}.도메인`
   *   ③ carvior User(role=admin, company=code) 발주사 계정
   *
   * ⚠ 특히 ③이 없으면 접수 자체는 되지만 bookings.service.ts의 isRestrictedSource()가
   * "미등록 발주사"로 판정해서 **자동배정·평가사 브로드캐스트·관리자 알림톡이 전부
   * 건너뛰어진다**. 상사 가입 시 발주사 계정을 같이 만들어야 하는 이유가 이것이다.
   */
  @Column({ unique: true })
  code: string;

  /** 상사 이름 — 관리자가 목록에서 알아볼 수 있게. 접수 데이터에는 쓰지 않는다. */
  @Column()
  name: string;

  @Column({ unique: true })
  clientId: string;

  /**
   * bcrypt 해시. 평문 시크릿은 발급할 때 한 번만 보여주고 저장하지 않는다 —
   * DB가 새어도 남의 상사 이름으로 접수를 넣을 수는 없어야 한다.
   */
  @Column()
  clientSecretHash: string;

  /**
   * 쉼표로 구분한 권한.
   *   inspection:write        검차 주문
   *   inspections:read        주문한 건의 진행상태·리포트 조회
   *   completed-contracts:read  계약 완료건 조회 (애니원모터스 매입 내역 가져오기)
   *
   * 상사 제품 v1은 앞의 두 개만 받는다. 계약 조회는 매입 대행을 같이 하는 상사만 쓴다.
   */
  @Column({ default: 'inspection:write,inspections:read' })
  scopes: string;

  /** 끊을 때 레코드를 지우지 않고 이걸 내린다 — 지우면 어느 상사가 넣은 접수인지 추적이 끊긴다. */
  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
