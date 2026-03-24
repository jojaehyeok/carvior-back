// inspection.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Booking } from '../../bookings/entities/booking.entity';

@Entity('inspections')
export class Inspection {
    @PrimaryGeneratedColumn()
    id: number;

    @OneToOne(() => Booking, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'bookingId' })
    booking: Booking;

    @Column() 
    bookingId: number;

    @Column()
    carNumber: string;

    @Column({ nullable: true })
    carModel: string;

    @Column({ type: 'int', default: 0 })
    mileage: number;

    // 추가: 검수 전용 예상 복구 비용
    @Column({ type: 'int', nullable: true })
    repairCost: number;

    @Column({ type: 'text', nullable: true })
    dashboardImage: string;

    @Column({ type: 'text', nullable: true })
    regImage: string;

    @Column({ type: 'text', nullable: true })
    vinImage: string;

    // 프런트엔드 payload 구조에 맞춘 상세 정보
    @Column({ type: 'json', nullable: true })
    inspectionDetails: {
        warningDesc: string;
        leakDesc: string;
        optionsDesc: string; // 필드명 매칭
        driveDesc: string;   // 필드명 매칭
    };

    // 추가: 차키 정보, 타이어 잔존량, 도색/휠 상태 등
    @Column({ type: 'json', nullable: true })
    carStatus: {
        keys: { smart: number; general: number; folding: number; special: number };
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
    };

    @Column({ type: 'text', nullable: true })
    memo: string;

    @CreateDateColumn()
    completedAt: Date;
}