import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Vehicle } from './entities/vehicle.entity';

// 아직 판매매물(SaleListing)로 전환되지 않은 상태 — "판매매물이 아니다"를 코드로 강제하는 지점.
// LISTED가 되면 이 목록에서 빠진다(판매매물 관리 화면으로 넘어감, 3단계에서 구현).
const UNMATCHED_STATUSES = [
  'UNMATCHED_INSPECTED',
  'OWNER_CONTACT_PENDING',
  'OWNER_CONTACTED',
  'OWNER_DECLINED_TO_SELL',
  'OWNER_AGREED_TO_SELL',
];

const VALID_SALE_STATUSES = ['NONE', ...UNMATCHED_STATUSES, 'LISTED'];

@Injectable()
export class VehiclesService {
  constructor(
    @InjectRepository(Vehicle)
    private readonly repo: Repository<Vehicle>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // 진단 최초완료 시점에 inspection.service.ts에서 호출 — 같은 차량번호로 이미 Vehicle이 있으면
  // 재사용(재검차 케이스), saleStatus는 처음 생성될 때만 UNMATCHED_INSPECTED로 시작하고
  // 이미 판매전환 등으로 진행된 차량은 되돌리지 않는다.
  async linkInspection(params: {
    inspectionId: number;
    carNumber: string;
    requesterName: string | null;
    requesterContact: string | null;
    ownerContact: string | null; // Booking.customerContact — 있으면 실제 차주 연락처로 시딩
  }): Promise<Vehicle> {
    const clean = (params.carNumber || '').trim();
    let vehicle = clean ? await this.repo.findOne({ where: { carNumber: clean } }) : null;

    if (!vehicle) {
      vehicle = this.repo.create({
        carNumber: clean,
        latestInspectionId: params.inspectionId,
        requesterName: params.requesterName,
        requesterContact: params.requesterContact,
        ownerContact: params.ownerContact,
        saleStatus: 'UNMATCHED_INSPECTED',
      });
    } else {
      vehicle.latestInspectionId = params.inspectionId;
      if (vehicle.saleStatus === 'NONE') vehicle.saleStatus = 'UNMATCHED_INSPECTED';
      // 이미 있던 차량이면 요청자/차주 정보는 덮어쓰지 않음(운영자가 이미 확인해둔 값을 보존)
    }

    return this.repo.save(vehicle);
  }

  // 미매칭 검차차량 목록(관리자 화면) — 최신 진단/접수 정보를 함께 반환
  async findUnmatched(): Promise<any[]> {
    return this.dataSource.query(
      `
      SELECT v.*,
        i.carModel AS inspectionCarModel,
        i.mileage AS inspectionMileage,
        i.completedAt AS inspectionCompletedAt,
        i.carHash AS inspectionCarHash,
        b.carOwner AS bookingCarOwner,
        b.contact AS bookingContact,
        b.customerContact AS bookingCustomerContact
      FROM vehicles v
      LEFT JOIN inspections i ON i.id = v.latestInspectionId
      LEFT JOIN bookings b ON b.id = i.bookingId
      WHERE v.saleStatus IN (?, ?, ?, ?, ?)
      ORDER BY v.updatedAt DESC
      `,
      UNMATCHED_STATUSES,
    );
  }

  async findOne(id: number): Promise<Vehicle> {
    const vehicle = await this.repo.findOneBy({ id });
    if (!vehicle) throw new NotFoundException(`차량 ${id}을 찾을 수 없습니다.`);
    return vehicle;
  }

  // 관리자가 미매칭 관리 화면에서 차주 연락상태/정보를 갱신
  async update(id: number, data: Partial<Vehicle>): Promise<Vehicle> {
    const vehicle = await this.findOne(id);

    if (data.saleStatus && !VALID_SALE_STATUSES.includes(data.saleStatus)) {
      throw new NotFoundException(`알 수 없는 saleStatus: ${data.saleStatus}`);
    }

    const now = new Date();
    if (data.saleStatus === 'OWNER_CONTACTED' && !vehicle.ownerContactedAt) {
      vehicle.ownerContactedAt = now;
    }
    if (
      (data.saleStatus === 'OWNER_AGREED_TO_SELL' || data.saleStatus === 'OWNER_DECLINED_TO_SELL') &&
      !vehicle.ownerRespondedAt
    ) {
      vehicle.ownerRespondedAt = now;
    }

    Object.assign(vehicle, data);
    return this.repo.save(vehicle);
  }
}
