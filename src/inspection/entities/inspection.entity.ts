// inspection.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn, Index } from 'typeorm';
import { Booking } from '../../bookings/entities/booking.entity';

@Entity('inspections')
export class Inspection {
    @PrimaryGeneratedColumn()
    id: number;

    @OneToOne(() => Booking, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'bookingId' })
    booking: Booking;

    @Index()
    @Column()
    bookingId: number;

    @Column()
    carNumber: string;

    @Index()
    @Column({ nullable: true })
    carHash: string;

    @Column({ nullable: true })
    carModel: string;

    @Column({ type: 'int', default: 0 })
    mileage: number;

    @Column({ nullable: true })
    color: string;

    // 추가: 검수 전용 예상 복구 비용
    @Column({ type: 'int', nullable: true })
    repairCost: number;

    @Column({ type: 'text', nullable: true })
    dashboardImage: string;

    @Column({ type: 'text', nullable: true })
    regImage: string;

    @Column({ type: 'text', nullable: true })
    vinImage: string;

    // 수출용 차량 영상(각 최대 15초, 최대 5개) — datrade처럼 "수출전용"으로 표시된
    // 발주사 건에서만 노출/요구되며, 엔진 시동음 등 수출 심사에 필요한 영상들
    @Column({ type: 'json', nullable: true })
    exportVideoUrls: string[] | null;

    // (구) 엔진 소음 확인용 단일 영상 — videoUrls로 대체됨. 과거 데이터 호환을 위해 컬럼만 유지.
    @Column({ type: 'text', nullable: true })
    engineNoiseVideoUrl: string | null;

    // 엔진 이음/조향 이음/옵션작동 이상 등 진단사가 촬영한 영상 여러 개(사진과 동일하게 다건 업로드).
    @Column({ type: 'json', nullable: true })
    videoUrls: string[] | null;

    // 프런트엔드 payload 구조에 맞춘 상세 정보
    @Column({ type: 'json', nullable: true })
    inspectionDetails: {
        warningDesc: string;
        leakDesc: string;
        optionsDesc: string; // 필드명 매칭
        driveDesc: string;   // 필드명 매칭
        engineDesc: string;
    };

    // 확인사항(경고등/옵션/누유/주행중 이상/엔진룸 이상) 각 항목별 첨부사진 — "기타의견" 공용
    // 사진첩과 섞이지 않도록 항목별로 분리 보관. 리포트에서도 해당 항목 바로 아래에 노출된다.
    @Column({ type: 'json', nullable: true })
    checklistPhotos: {
        warning: string[];
        options: string[];
        leak: string[];
        drive: string[];
        engine: string[];
    } | null;

    // 추가: 차키 정보, 타이어 잔존량, 도색/휠 상태 등
    @Column({ type: 'json', nullable: true })
    carStatus: {
        keys: { smart: number; general: number; folding: number; special: number; note?: string };
        paintNeeded: number;
        wheelScratch: number;
        tireTread: { front: number; back: number };
    };

    // 추가: 손상 체크 데이터 (2차원 배열)
    @Column({ type: 'json', nullable: true })
    checkedDamages: string[][];

    // 추가: 사이드 미러 상태 (검수 전용)
    @Column({ type: 'json', nullable: true })
    mirrorMarkers?: any;

    @Column({ type: 'json', nullable: true })
    photos: {
        exterior: string[];
        wheel: string[];
        undercarriage: string[];
        interior: string[];
        engine: string[];
        damage: string[];
        extra: string[];
        extraMemo: string[];
    };

    @Column({ type: 'text', nullable: true })
    memo: string;

    @Column({ type: 'timestamp', nullable: true })
    completedAt: Date;

    // 최초 진단완료 시각 — completedAt과 달리 재저장해도 바뀌지 않는 고정 기준점.
    // 진단사 수정마감(2h)/매니저 검토(2h~4h)/자동게시(4h) 타임라인의 앵커로 사용.
    @Column({ type: 'timestamp', nullable: true })
    firstCompletedAt: Date;

    // 딜러 의뢰 리포트(수출용 차량 등) 다국어 지원용 — 평가사가 입력한 자유 텍스트(메모류)만
    // Azure Translator로 최초 1회 번역해서 캐싱해둔다. { en: {memo, warningDesc, ...}, ru: {...}, ar: {...} }
    // null이면 아직 한 번도 번역 요청이 없었다는 뜻(무료 API 호출량 절약을 위해 지연 계산).
    @Column({ type: 'json', nullable: true })
    translations: Record<string, Record<string, string>> | null;
}