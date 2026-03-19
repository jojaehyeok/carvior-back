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

    @Column({ type: 'text', nullable: true })
    dashboardImage: string;

    @Column({ type: 'text', nullable: true })
    regImage: string;

    // ✅ 서비스 코드의 inspection.inspectionDetails와 이름을 맞췄습니다.
    @Column({ type: 'json', nullable: true })
    inspectionDetails: {
        warningDesc: string;
        leakDesc: string;
        tuningDesc: string;
        tireDesc: string;
        accidentDesc: string;
        notice: string;
        merit: string;
    };

    // ✅ 사진 리스트 (JSON)
    @Column({ type: 'json', nullable: true })
    photos: {
        exterior: string[];
        wheel: string[];
        undercarriage: string[];
        interior: string[];
        engine: string[];
    };

    @CreateDateColumn()
    completedAt: Date;
}