import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BuyerRequest } from './entities/buyer-request.entity';
import { CreateBuyerRequestDto } from './dto/create-buyer-request.dto';
import { SolapiService } from '../solapi/solapi.service';
import { Booking } from '../bookings/entities/booking.entity';

// 관리자 수신 번호
const ADMIN_PHONE = '01022856017';

@Injectable()
export class BuyerRequestService {
  constructor(
    @InjectRepository(BuyerRequest)
    private readonly repo: Repository<BuyerRequest>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly solapiService: SolapiService,
  ) {}

  async create(dto: CreateBuyerRequestDto): Promise<BuyerRequest> {
    // carOwner 필드로 들어오는 경우 buyerName으로 매핑
    const buyerName = dto.buyerName || dto.carOwner || '';

    const entity = this.repo.create({
      buyerName,
      contact: dto.contact,
      address: dto.address,
      detailAddress: dto.detailAddress,
      preferredDateTime: dto.preferredDateTime,
      desiredPrice: dto.desiredPrice,
      additionalMemo: dto.additionalMemo,
      source: dto.source || 'PRIVATE_DEAL_FORM',
      privacyAgreed: dto.privacyAgreed ?? false,
    });

    const saved = await this.repo.save(entity);

    // 관리자에게 SMS 즉시 발송 (알림톡 템플릿 없어도 SMS로 바로 받을 수 있도록)
    try {
      const visitDate = saved.preferredDateTime || '미정';
      const priceText = saved.desiredPrice ? `희망가: ${saved.desiredPrice}` : '가격 미입력';
      const sourceText = saved.source || '-';

      const smsText =
        `[카비어] 구매대행 신청 접수\n` +
        `━━━━━━━━━━━━━━\n` +
        `#${saved.id} · ${sourceText}\n` +
        `신청자: ${saved.buyerName}\n` +
        `연락처: ${saved.contact}\n` +
        `방문일시: ${visitDate}\n` +
        `차량위치: ${saved.address}` +
        (saved.detailAddress ? ` ${saved.detailAddress}` : '') + `\n` +
        `${priceText}\n` +
        (saved.additionalMemo ? `메모: ${saved.additionalMemo.slice(0, 40)}` : '');

      await this.solapiService.sendSms(ADMIN_PHONE, smsText);
      console.log(`✅ [구매대행] 관리자 SMS 발송 완료 → #${saved.id} ${saved.buyerName}`);
    } catch (e) {
      // SMS 실패해도 DB 저장은 성공으로 처리
      console.error(`❌ [구매대행] 관리자 SMS 발송 실패 → ID ${saved.id}`, e);
    }

    return saved;
  }

  async findAll(source?: string): Promise<BuyerRequest[]> {
    return this.repo.find({
      where: source ? { source } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<BuyerRequest> {
    const item = await this.repo.findOneBy({ id });
    if (!item) throw new NotFoundException(`#${id} 신청 내역을 찾을 수 없습니다.`);
    return item;
  }

  async updateStatus(
    id: number,
    updateData: Partial<BuyerRequest>,
  ): Promise<BuyerRequest> {
    const item = await this.findOne(id);
    Object.assign(item, updateData);
    return this.repo.save(item);
  }

  async assign(id: number, driverInfo: { id: string; name: string }): Promise<BuyerRequest> {
    const item = await this.findOne(id);
    item.assignedDriverId = driverInfo.id;
    item.assignedDriverName = driverInfo.name;
    item.status = 'ASSIGNED';
    return this.repo.save(item);
  }

  async convertToBooking(id: number, carNumber: string, carOwner: string): Promise<Booking> {
    const item = await this.findOne(id);

    const booking = this.bookingRepo.create({
      carNumber,
      carOwner,
      dealerName: item.buyerName,    // 구매 의뢰인이 딜러 역할
      contact: item.contact,
      address: item.address,
      detailAddress: item.detailAddress,
      preferredDateTime: item.preferredDateTime,
      additionalMemo: item.additionalMemo,
      source: item.source,
      assignedDriverId: item.assignedDriverId,
      assignedDriverName: item.assignedDriverName,
      status: item.assignedDriverId ? 'ASSIGNED' : 'PENDING',
    });

    const saved = await this.bookingRepo.save(booking);

    // 상담 상태를 COMPLETED로 변경 (진단 접수로 전환됨)
    item.status = 'COMPLETED';
    item.adminMemo = (item.adminMemo ? item.adminMemo + '\n' : '') + `진단 접수 전환 → booking #${saved.id}`;
    await this.repo.save(item);

    return saved;
  }
}
