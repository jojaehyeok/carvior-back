import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// 자동차관리법 제65조의2제4항 / 시행규칙 제144조의3 — 온라인 자동차매매정보제공자는
// 아래 항목을 3년간 보관해야 함. StoreItem/Inspection과 별개 테이블로 두는 이유:
// 매물이 나중에 수정·삭제되더라도(status hidden, 관리자 삭제 등) 법정 보관 의무는
// 별도로 살아있어야 하므로 이 테이블은 절대 UPDATE/DELETE하지 않는 append-only 기록.
@Entity('compliance_records')
export class ComplianceRecord {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  storeItemId: number;

  @Column({ nullable: true })
  bookingId: number;

  @Column({ nullable: true })
  carHash: string;

  @Column()
  plateNumber: string; // 자동차등록번호

  @Column({ nullable: true })
  vin: string; // 차대번호

  @Column({ nullable: true })
  carName: string; // 차명

  @Column({ nullable: true })
  vehicleType: string; // 자동차 종류·구분

  @Column({ nullable: true })
  engineType: string; // 원동기형식

  @Column({ nullable: true })
  usageType: string; // 용도(자가용/영업용 등)

  @Column({ nullable: true })
  modelYear: string; // 연식

  @Column({ nullable: true })
  color: string; // 색상

  @Column({ nullable: true })
  mileage: string; // 총주행거리(기록 시점)

  @Column({ nullable: true })
  registrationDate: string; // 최초등록일

  @Column({ nullable: true })
  manufactureDate: string; // 제작연월일

  @Column({ nullable: true })
  inspectionValidUntil: string; // 검사유효기간

  @Column({ nullable: true })
  ownerName: string; // 소유자명(제공 당시)

  @Column({ nullable: true })
  ownerAddress: string; // 소유자 주소(사용본거지)

  @Column({ type: 'text', nullable: true })
  sourceImageUrl: string; // 등록증 원본 이미지 URL (S3)

  @Column({ type: 'json', nullable: true })
  rawOcr: Record<string, unknown>; // OCR 원본 전체 스냅샷 — 필드 누락 대비 원문 보존

  @CreateDateColumn()
  capturedAt: Date; // 이 기록을 저장한 시각

  @Column({ type: 'timestamp' })
  retainUntil: Date; // capturedAt + 3년 — 법정 보관 만료일
}
