import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SaleListing } from './entities/sale-listing.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';

// 입찰기간 기본값 — 스마트옥션(StoreItem)의 48h 기준을 그대로 참고했지만, 이 시스템은
// 별도로 구축하는 거라 필요하면 여기만 독립적으로 조정 가능.
const DEFAULT_BIDDING_HOURS = 48;

@Injectable()
export class SaleListingsService {
  constructor(
    @InjectRepository(SaleListing)
    private readonly repo: Repository<SaleListing>,
    @InjectRepository(Vehicle)
    private readonly vehicleRepo: Repository<Vehicle>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // 차주 판매동의(OWNER_AGREED_TO_SELL)를 받은 차량만 매물로 전환 가능 — 이 가드가
  // "차주 동의 없이 매물 생성 금지" 원칙을 코드로 강제하는 지점.
  async createFromVehicle(
    vehicleId: number,
    data: { askingPrice: number; minimumAcceptablePrice?: number | null },
  ): Promise<SaleListing> {
    const vehicle = await this.vehicleRepo.findOneBy({ id: vehicleId });
    if (!vehicle) throw new NotFoundException(`차량 ${vehicleId}을 찾을 수 없습니다.`);
    if (vehicle.saleStatus !== 'OWNER_AGREED_TO_SELL') {
      throw new BadRequestException('차주 판매동의(OWNER_AGREED_TO_SELL) 상태인 차량만 매물로 전환할 수 있습니다.');
    }
    if (!data.askingPrice || data.askingPrice <= 0) {
      throw new BadRequestException('희망가격을 입력해주세요.');
    }

    const now = new Date();
    const listing = this.repo.create({
      vehicleId: vehicle.id,
      inspectionId: vehicle.latestInspectionId,
      ownerId: vehicle.ownerUserId,
      ownerConsent: true,
      askingPrice: data.askingPrice,
      minimumAcceptablePrice: data.minimumAcceptablePrice ?? null,
      listingStatus: 'ACTIVE',
      biddingStartAt: now,
      biddingEndAt: new Date(now.getTime() + DEFAULT_BIDDING_HOURS * 60 * 60 * 1000),
    });
    const saved = await this.repo.save(listing);

    vehicle.saleStatus = 'LISTED';
    await this.vehicleRepo.save(vehicle);

    return saved;
  }

  // 마이페이지 "스마트옥션에 출품하기" 전용 셀프서비스 플로우 — 검차를 신청했던 사람이
  // 실제로 그 차를 구매완료했다고 스스로 표시한 뒤, 이제 본인이 차주가 됐으니 직접 판매동의도
  // 함께 처리한다(관리자 전화확인 대신 구매자 본인 확인으로 대체 — 스펙 3번 "차주 동의 없이
  // 매물 생성 금지" 원칙은 유지하되 동의 주체만 다름). 기존 스마트옥션(StoreItem)으로 출품하던
  // 걸 이 시스템으로 대체(2026-08-09 결정).
  async createSelfServiceListing(
    carNumber: string,
    ownerName: string,
    ownerContact: string,
    askingPrice: number,
  ): Promise<SaleListing> {
    const clean = (carNumber || '').trim();
    const vehicle = await this.vehicleRepo.findOne({ where: { carNumber: clean } });
    if (!vehicle) throw new NotFoundException('검차 이력이 있는 차량만 출품할 수 있습니다.');
    if (vehicle.saleStatus === 'LISTED') {
      throw new BadRequestException('이미 출품된 차량입니다.');
    }

    vehicle.ownerName = ownerName;
    vehicle.ownerContact = ownerContact;
    vehicle.requesterIsOwner = true;
    vehicle.saleStatus = 'OWNER_AGREED_TO_SELL';
    if (!vehicle.ownerRespondedAt) vehicle.ownerRespondedAt = new Date();
    await this.vehicleRepo.save(vehicle);

    return this.createFromVehicle(vehicle.id, { askingPrice });
  }

  // 판매매물 목록(관리자 화면) — 차량/검차 정보를 함께 반환
  async findAll(): Promise<any[]> {
    return this.dataSource.query(`
      SELECT sl.*,
        v.carNumber, v.ownerName, v.ownerContact,
        i.carModel AS inspectionCarModel,
        i.mileage AS inspectionMileage,
        i.carHash AS inspectionCarHash
      FROM sale_listings sl
      LEFT JOIN vehicles v ON v.id = sl.vehicleId
      LEFT JOIN inspections i ON i.id = sl.inspectionId
      ORDER BY sl.createdAt DESC
    `);
  }

  async findOne(id: number): Promise<SaleListing> {
    const listing = await this.repo.findOneBy({ id });
    if (!listing) throw new NotFoundException(`판매매물 ${id}을 찾을 수 없습니다.`);
    return listing;
  }

  // 딜러 화면(4단계, 판매차량 목록)용 — 스펙 15번 금지사항: 차주 개인정보(ownerName/ownerContact/
  // requesterName/requesterContact)는 절대 포함하지 않는다. 검차사진/결과/희망가격만 노출.
  async findAllForDealer(): Promise<any[]> {
    return this.dataSource.query(`
      SELECT sl.id, sl.askingPrice, sl.minimumAcceptablePrice, sl.listingStatus,
        sl.biddingStartAt, sl.biddingEndAt, sl.createdAt,
        v.carNumber,
        i.carModel, i.mileage, i.color, i.carHash
      FROM sale_listings sl
      LEFT JOIN vehicles v ON v.id = sl.vehicleId
      LEFT JOIN inspections i ON i.id = sl.inspectionId
      WHERE sl.listingStatus IN ('ACTIVE', 'TARGET_PRICE_MET')
      ORDER BY sl.createdAt DESC
    `);
  }

  async findOneForDealer(id: number): Promise<any> {
    const rows = await this.dataSource.query(`
      SELECT sl.id, sl.askingPrice, sl.minimumAcceptablePrice, sl.listingStatus,
        sl.biddingStartAt, sl.biddingEndAt, sl.createdAt,
        v.carNumber,
        i.carModel, i.mileage, i.color, i.carHash, i.photos, i.inspectionDetails,
        i.checklistPhotos, i.carStatus, i.checkedDamages
      FROM sale_listings sl
      LEFT JOIN vehicles v ON v.id = sl.vehicleId
      LEFT JOIN inspections i ON i.id = sl.inspectionId
      WHERE sl.id = ?
    `, [id]);
    if (!rows[0]) throw new NotFoundException(`판매매물 ${id}을 찾을 수 없습니다.`);
    return rows[0];
  }
}
