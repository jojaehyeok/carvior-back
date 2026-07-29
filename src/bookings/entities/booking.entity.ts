import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ default: 'PENDING' })
  status: string;

  // --- 진단사 배정 관련 컬럼 추가 ---
  @Column({ type: 'varchar', nullable: true })
  assignedDriverId: string | null;

  @Column({ type: 'varchar', nullable: true })
  assignedDriverName: string | null;

  // 에이전트 진단평가사가 이 건을 다른 진단사에게 "지정 배정"했을 때 그 에이전트의 driver.id.
  // null이면 자동배정/일반 수동배정/본인 확정 — 에이전트가 배정한 건만 그 에이전트가
  // assignedDriverId와 무관하게 리포트를 대신 수정할 수 있게 하는 데 사용
  @Column({ type: 'varchar', nullable: true })
  assignedByAgentId: string | null;

  // 일반 평가사가 담당 건에 대해 "라운딩"(진단/에이전트 등급에게 인계) 요청한 상태.
  // 요청 중엔 진단/에이전트 등급 진단사들의 예약 요청 탭에도 노출되고, 수락되면
  // assignedDriverId가 수락한 사람으로 바뀌면서 false로 초기화됨
  @Column({ default: false })
  roundingRequested: boolean;

  @Column({ type: 'timestamp', nullable: true })
  roundingRequestedAt: Date | null;

  // 진단평가사가 현장에서 직접 남기는 메모(특이사항 등) — 앱 더보기 메뉴에서 조회/수정
  @Column({ type: 'text', nullable: true })
  driverMemo: string | null;

  // 관리자가 "긴급·당일배정"으로 수동 브로드캐스트한 건 — 스케줄/활동중 여부와 무관하게
  // 전체 진단사에게 알림이 가고, 앱 예약 요청 탭에 강조 표시됨
  @Column({ default: false })
  isUrgent: boolean;

  // 자동배정 알고리즘이 어떤 후보들을 비교해서 왜 이 진단사를 골랐는지 기록 —
  // 수동 배정 건은 null(대시보드 UI에서 "수동 배정"으로 표시), SUPER_ADMIN 전용 확인용
  @Column({ type: 'simple-json', nullable: true })
  autoAssignLog: Record<string, unknown> | null;

  // 접수 시점에 1회 계산해서 저장하는 거리 진단 정보(대시보드 표시 전용, 배정 로직에는 영향 없음).
  // nearestDriverKm: 승인된 진단사 중 좌표가 있는 가장 가까운 사람까지의 편도 거리(km).
  // remoteTier: 'semi_remote'(편도 25km↑)/'remote'(편도 50km↑) — 관리자가 발주사와 가격협상할지 판단하는 용도.
  // urgentCandidate: 방문예정일이 접수 당일이고, 지역 맞는 진단사는 있는데 그중 활동중인 사람이 없어
  //   자동배정도 일반 브로드캐스트(활동중 대상)도 사실상 아무에게도 안 갔을 가능성이 있는 건 — 관리자가
  //   수동으로 "긴급·당일배정" 브로드캐스트를 눌러야 할 후보임을 알려주는 표시일 뿐, 자동 발송은 하지 않음.
  @Column({ type: 'float', nullable: true })
  nearestDriverKm: number | null;

  @Column({ type: 'varchar', nullable: true })
  remoteTier: 'semi_remote' | 'remote' | null;

  @Column({ default: false })
  urgentCandidate: boolean;
  // ------------------------------

  // /inspection(검차 신청 결제) 계좌이체 건 전용 — 카드/간편결제는 토스 결제 성공 콜백 이후에만
  // 예약이 생성되니 입금이 이미 확인된 것이지만, 계좌이체는 버튼만 누르면 예약이 생성돼서
  // 실제 입금 여부를 알 수 없다. paymentMethod가 'BANK_TRANSFER'인 건은 depositConfirmed가
  // true가 되기 전까지 자동배정/브로드캐스트를 보류한다(관리자가 입금 확인 후 수동으로 트리거).
  @Column({ type: 'varchar', nullable: true })
  paymentMethod: string | null;

  @Column({ default: true })
  depositConfirmed: boolean;

  // 구매동행(/inspection) 신청 시 선택한 차량 구분 — 국산차/수입차에 따라 프로모션 결제
  // 금액이 다르다(app/inspection/page.tsx의 CAR_TYPE_PRICING과 짝을 이룸).
  @Column({ type: 'varchar', nullable: true })
  carOrigin: 'DOMESTIC' | 'IMPORTED' | null;

  // 실제 결제(또는 계좌이체 신청) 금액 — VAT 포함, 프로모션 할인 적용된 최종 금액(원)
  @Column({ type: 'int', nullable: true })
  amount: number | null;

  @Column()
  carNumber: string;

  // 차량명(모델명) — 접수 시점엔 모르는 경우가 많아, 평가사가 현장에서 진단 시작할 때
  // 차량번호/차주성함과 같은 자리에서 채워넣을 수 있게 함
  @Column({ type: 'varchar', nullable: true })
  carModel: string | null;

  @Column({ nullable: true })
  carOwner: string;

  @Column({ nullable: true })
  dealerName: string;

  // 구매동행(/inspection) 신청 시 딜러를 통해 거래 중인 매물이면 딜러 연락처만 알고
  // 차량번호/소유주는 모르는 경우가 많아서 별도로 받는다
  @Column({ nullable: true })
  dealerContact: string;

  // 구매동행 신청 시 당근마켓 등 중고거래 매물 링크 — 차량번호를 몰라도 이 링크로
  // 어떤 차량인지 담당 평가사가 확인할 수 있게 한다
  @Column({ type: 'text', nullable: true })
  listingUrl: string;

  @Column()
  contact: string;

  @Column()
  address: string;

  @Column({ nullable: true })
  detailAddress: string;

  @Column()
  preferredDateTime: string;

  @Column({ nullable: true })
  desiredPrice: string;

  @Column({ default: false })
  privacyAgreed: boolean;

  @Column({ type: 'text', nullable: true })
  additionalMemo: string;

  @Column({ default: 'SNS_PROMOTION' })
  source: string;

  // --- 오더 기록 필드 ---
  @Column({ nullable: true })
  contractWriter: string; // 계약서 작성자

  @Column({ default: false })
  vehicleTransferred: boolean; // 차량 이전 여부

  @Column({ default: false })
  contractConfirmed: boolean; // 계약 상태 확인 여부(계약완료 확인/미확인)

  @Column({ type: 'int', nullable: true })
  purchasePrice: number | null; // 매입가 (만원)

  // 매입가 처리 완료 여부 — 값이 새로 적히면(바뀌면) false(미완료)로 초기화되고,
  // 관리자가 목록에서 "미완료" 태그를 클릭하면 true(완료)로 토글됨
  @Column({ default: true })
  purchasePriceSeen: boolean;

  @Column({ default: false })
  isOldDealerPurchase: boolean; // (구) 구전 매입 여부 — oldDealerFee(금액 입력)로 대체, 컬럼은 하위호환용으로 유지

  @Column({ type: 'int', nullable: true })
  oldDealerFee: number | null; // 구전 금액 (만원) — 예/아니오 대신 실제 지급액을 기록

  // purchasePriceSeen과 동일한 용도, 구전 금액용
  @Column({ default: true })
  oldDealerFeeSeen: boolean;

  // 진단사 정산 관련 — 슈퍼관리자만 입력(대시보드 booking-list.tsx). 앱 정산내역(settlement-history)에서
  // 기본 진단비(등급별)에 더하거나 뺄 때 사용한다.
  // 오지/준오지/긴급건 등에 대한 추가 수당(원) — 준오지 +1만원/오지 +2만원/긴급 +1만원을
  // 대시보드에서 기본값으로 제안하되, 최종 금액은 관리자가 직접 입력해 저장한다.
  @Column({ type: 'int', nullable: true })
  remoteBonus: number | null;

  // 기타 비용/인센티브(원) — 유류비, 톨비, 고생한 건에 대한 성과급 등 케이스별로
  // 관리자가 자유롭게 지급하는 금액. 무엇에 대한 금액인지 알 수 있게 메모를 같이 남긴다.
  @Column({ type: 'int', nullable: true })
  extraFee: number | null;

  @Column({ type: 'varchar', nullable: true })
  extraFeeMemo: string | null;

  // 안심케어 클레임이 확정되어 해당 건 정산에서 차감할 금액(원)
  @Column({ type: 'int', nullable: true })
  claimDeduction: number | null;

  // 에이전트 관리수당(원) — 에이전트가 다른 평가사에게 지정 배정(assignedByAgentId)한 건에
  // 배정/관리 책임에 대한 대가로 붙는 금액. 실제 진단비(baseFee)와 달리 이 값은 배정한
  // 에이전트 본인의 정산에 "관리수당" 항목으로 잡히고, 실제 진단한 평가사 정산과는 무관하다.
  // 대시보드에서 배정 대상 평가사 등급 기준 기본값(일반 +1만원/진단평가사 +5천원)을 제안하되
  // 최종 금액은 관리자가 직접 입력한다. 라운딩 이관 등 등급으로 자동 판단이 안 되는 경우는
  // 관리자가 직접 금액(예: 6천원)과 메모를 입력.
  @Column({ type: 'int', nullable: true })
  agentBonus: number | null;

  @Column({ type: 'varchar', nullable: true })
  agentBonusMemo: string | null;

  // 계약팀이 오더 진행 중 직접 확인·기록하는 고객(차주) 연락처 — 접수 시 받는
  // contact는 신청자(딜러/고객) 번호라 실제 차주 번호와 다를 수 있어 별도 필드로 관리
  @Column({ type: 'varchar', nullable: true })
  customerContact: string | null;
  // ----------------------

  @Column({ type: 'text', nullable: true })
  adminMemo: string;

  // 진단사 취소로 재대기 전환된 시각 (null이면 일반 PENDING)
  @Column({ type: 'timestamp', nullable: true })
  cancelledByDriverAt: Date | null;

  // 배정된 진단사가 앱에서 이 건의 상세화면을 처음 연 시각 — 자동배정은 앱 푸시를
  // 놓칠 수 있어서, 관리자가 대시보드에서 "평가사가 실제로 확인했는지"를 볼 수 있게
  // 최초 1회만 기록한다(재조회해도 갱신 안 함, 재배정되면 markSeen()에서 null로 초기화).
  @Column({ type: 'timestamp', nullable: true })
  driverSeenAt: Date | null;

  // 현재 배정 건이 언제/어떤 경로로 배정됐는지 — assign() 호출 시마다 갱신됨.
  // 수동배정(manual)은 관리자가 진단사에게 이미 직접 안내했다고 보고, driverSeenAt과
  // 무관하게 assignedAt을 "확인" 시각으로 대시보드에 표시한다(대시보드 booking-list.tsx 참고).
  @Column({ type: 'timestamp', nullable: true })
  assignedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  assignSource: 'auto' | 'manual' | 'agent' | null;

  // 리뷰 요청 SMS 중복 발송 방지용 — 한 건당 1회만 보낼 수 있게 최초 발송 시각을 기록
  @Column({ type: 'timestamp', nullable: true })
  reviewRequestedAt: Date | null;

  // 고객이 예약번호+연락처로 직접 취소한 건인지 여부(관리자 취소와 구분용)
  @Column({ default: false })
  cancelledBySelf: boolean;

  // 셀프취소 시점에 환불 규정에 따라 계산된 환불 예정 금액(원) — 실제 환불은 관리자가
  // 토스/계좌이체로 수동 처리하며, 이 값은 그 처리를 위한 참고값일 뿐 자동 환불은 하지 않음.
  @Column({ type: 'int', nullable: true })
  refundAmount: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}