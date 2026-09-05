import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('driver_cancel_logs')
export class DriverCancelLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  driverId: string;

  @Column()
  driverName: string;

  @Column()
  bookingId: number;

  @Column({ nullable: true })
  carNumber: string;

  @Column({ nullable: true })
  carOwner: string;

  @Column({ nullable: true })
  cancelReason: string;

  // ── 판매자 노쇼 증빙 ─────────────────────────────────────────────
  // 헛걸음 보상을 판단하려면 "정말 그 시간에 그 장소에 갔는가"를 볼 수 있어야 한다.
  // EXIF는 메신저를 거치면 지워지고 편집도 쉬워서 쓰지 않는다 — 앱에서 즉석 촬영한
  // 그 순간의 시각·GPS를 앱이 직접 기록해서 보낸다.
  @Column({ type: 'simple-json', nullable: true })
  noshowProof: { url: string; takenAt: string; lat?: number | null; lng?: number | null }[] | null;

  // 자동으로 보상을 거부하지 않는다(GPS는 지하주차장 등에서 못 잡거나 오차가 크다).
  // 관리자가 한눈에 보고 판단하도록 결과만 남긴다.
  //   verified — 시간·거리 모두 기준 안
  //   suspect  — 하나라도 기준 밖
  //   unknown  — 시각이나 위치를 못 얻어 판정 불가
  @Column({ type: 'varchar', nullable: true })
  proofVerdict: 'verified' | 'suspect' | 'unknown' | null;

  // 예약시각 대비 촬영시각 차이(분). 음수면 예약 전에 찍은 것.
  @Column({ type: 'int', nullable: true })
  proofMinutesDiff: number | null;

  // 방문 주소와 촬영 위치 사이 거리(km)
  @Column({ type: 'float', nullable: true })
  proofDistanceKm: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
