import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Booking } from '../bookings/entities/booking.entity';
import { BookingsService } from '../bookings/bookings.service';
import { Inspection } from '../inspection/entities/inspection.entity';
import { PartnerClient } from './entities/partner-client.entity';
import { assertScope, PartnerOAuthGuard, PartnerTokenPayload } from './partner-oauth.guard';
import { BUILD_MARK } from '../build-info';

const REPORT_BASE_URL = 'https://carvior.store/car-report';

/** .env 한 곳만 쓰던 시절의 애니원모터스 열쇠에 주던 권한 — 매입 내역 가져오기까지 포함 */
const LEGACY_ENV_SCOPES = 'inspection:write,inspections:read,completed-contracts:read';

interface TokenRequestBody {
  grant_type?: string;
  client_id?: string;
  client_secret?: string;
}

/**
 * 상사 프로그램에서 넣는 검차 주문.
 *
 * source는 받지 않는다 — 토큰이 가리키는 상사 코드를 서버가 넣는다. body로 받으면
 * 남의 상사 이름으로 접수를 밀어넣을 수 있다.
 */
interface InspectionRequestBody {
  /** 필수 */
  carNumber?: string;
  /** 필수 — 차가 있는 곳(매입 전이면 차주 위치, 들어온 뒤면 단지 주소) */
  address?: string;
  /** 필수 — "2026-11-20 14:00" 같은 문자열. /available-slots로 고른 값을 그대로 넣는다 */
  preferredDateTime?: string;
  /** 필수 — 신청한 담당 직원 번호 */
  contact?: string;

  carModel?: string;
  detailAddress?: string;
  /** 담당 직원 이름·번호 — 리포트 완료 알림톡이 dealerContact로 간다 */
  dealerName?: string;
  dealerContact?: string;
  /** 차주 이름·번호(알면) — 평가사가 방문 약속을 잡을 때 쓴다 */
  carOwner?: string;
  customerContact?: string;
  additionalMemo?: string;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: '접수됨 (평가사 배정 대기)',
  ASSIGNED: '평가사 배정됨',
  CONFIRMED: '방문 확정',
  COMPLETED: '진단 완료',
  CANCELLED: '취소됨',
};

/** 필수 네 컬럼(Booking 엔티티에서 nullable이 아닌 것)과 상사 화면에 보여줄 이름 */
const REQUIRED_FIELDS: [keyof InspectionRequestBody, string][] = [
  ['carNumber', '차량번호'],
  ['address', '차량 위치(주소)'],
  ['preferredDateTime', '희망 일시'],
  ['contact', '신청자 연락처'],
];

@Controller('v1/partner-api')
export class PartnerApiController {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(Inspection)
    private readonly inspectionRepository: Repository<Inspection>,
    @InjectRepository(PartnerClient)
    private readonly partnerRepository: Repository<PartnerClient>,
    private readonly bookingsService: BookingsService,
    private readonly jwt: JwtService,
  ) {}

  // RFC 6749 client_credentials 그랜트 — 상사 쪽 시스템이 client_id/secret으로
  // access token을 발급받는 엔드포인트.
  //
  // 먼저 PartnerClient 테이블을 보고, 없으면 .env의 애니원모터스 열쇠로 폴백한다.
  // 폴백은 한 배포 주기용이다 — 애니원 서버가 이미 그 열쇠로 돌고 있어서, 테이블로
  // 옮기자마자 끊으면 매입 내역 가져오기가 멈춘다. 테이블에 애니원을 넣고 그쪽이
  // 정상 동작하는 걸 확인한 다음 이 폴백을 지운다.
  @Post('oauth/token')
  async issueToken(@Body() body: TokenRequestBody) {
    const { grant_type, client_id, client_secret } = body;
    if (grant_type !== 'client_credentials') {
      throw new UnauthorizedException({ error: 'unsupported_grant_type' });
    }
    if (!client_id || !client_secret) {
      throw new UnauthorizedException({ error: 'invalid_client' });
    }

    const partner = await this.partnerRepository.findOne({ where: { clientId: client_id } });
    if (partner) {
      if (!partner.active) {
        throw new UnauthorizedException({
          error: 'invalid_client',
          error_description: '중지된 계정입니다. 카비어 담당자에게 문의하세요.',
        });
      }
      const ok = await bcrypt.compare(client_secret, partner.clientSecretHash);
      if (!ok) throw new UnauthorizedException({ error: 'invalid_client' });
      return this.signToken(partner.code, partner.scopes);
    }

    // 폴백 — .env의 애니원모터스 열쇠
    if (
      process.env.ANYONE_MOTORS_CLIENT_ID &&
      client_id === process.env.ANYONE_MOTORS_CLIENT_ID &&
      client_secret === process.env.ANYONE_MOTORS_CLIENT_SECRET
    ) {
      return this.signToken('anyone-motors', LEGACY_ENV_SCOPES);
    }

    throw new UnauthorizedException({ error: 'invalid_client' });
  }

  private signToken(code: string, scopes: string) {
    const access_token = this.jwt.sign({ sub: code, scope: scopes });
    return { access_token, token_type: 'Bearer', expires_in: 3600, scope: scopes };
  }

  /**
   * 검차 주문.
   *
   * 접수 로직은 새로 쓰지 않는다 — bookingsService.create()를 그대로 부른다.
   * 자동배정·평가사 알림·좌표·묶음·관리자 알림톡이 전부 거기에 들어 있어서,
   * 여기서 따로 처리하면 두 경로가 반드시 갈라진다.
   *
   * requestType은 REMOTE_INSPECTION(비대면검차)으로 고정한다 — 상사가 의뢰한 건이라
   * 리포트가 차주가 아니라 상사(담당 직원)에게 가야 한다. 차주 전달은 상사가 직접 한다.
   */
  @UseGuards(PartnerOAuthGuard)
  @Post(':partner/inspection-request')
  async createInspectionRequest(
    @Param('partner') partner: string,
    @Body() body: InspectionRequestBody,
    @Req() req: { partnerClient?: PartnerTokenPayload },
  ) {
    assertScope(req.partnerClient, 'inspection:write');

    // 하나라도 비면 save에서 터지는데, 그때 나오는 메시지로는 무엇이 빠졌는지
    // 상사 화면에서 알 수 없다. 빠진 것의 이름을 그대로 돌려준다.
    const missing = REQUIRED_FIELDS.filter(([key]) => !body[key]?.trim()).map(([, label]) => label);
    if (missing.length) {
      throw new BadRequestException(`${missing.join(', ')}가 필요합니다.`);
    }

    const carNumber = body.carNumber!.trim();
    const contact = body.contact!.trim();
    // 같은 차를 두 번 주문하면 평가사가 두 명 가고 진단비가 두 번 청구된다.
    // 상사 화면에서도 막지만, 두 사람이 동시에 누르는 경우가 있어 여기서 한 번 더 본다.
    if (await this.bookingsService.checkOngoingBooking(carNumber)) {
      throw new ConflictException(`${carNumber}는 이미 진단이 진행 중입니다.`);
    }

    const created = await this.bookingsService.create({
      carNumber,
      carModel: body.carModel?.trim() || null,
      address: body.address!.trim(),
      detailAddress: body.detailAddress?.trim(),
      preferredDateTime: body.preferredDateTime!.trim(),
      contact,
      dealerName: body.dealerName?.trim(),
      // 리포트 완료 알림톡 수신자. 따로 안 보내면 신청자가 받는다.
      dealerContact: body.dealerContact?.trim() || contact,
      carOwner: body.carOwner?.trim(),
      customerContact: body.customerContact?.trim() || null,
      additionalMemo: body.additionalMemo?.trim(),
      source: partner,
      requestType: 'REMOTE_INSPECTION',
    });

    return {
      id: created.id,
      carNumber: created.carNumber,
      status: created.status,
      statusLabel: STATUS_LABELS[created.status] ?? created.status,
      assignedDriverName: created.assignedDriverName ?? null,
      // true면 carvior에 이 상사의 발주사 계정(User role=admin, company=코드)이 없어서
      // 자동배정·평가사 알림이 건너뛰어진 상태다. 접수 자체는 저장됐다.
      // 상사 화면에 그대로 띄워서 "왜 평가사가 안 붙지?"로 헤매지 않게 한다.
      needsPartnerSetup: !!created.restricted,
      build: BUILD_MARK,
    };
  }

  /**
   * 주문한 건의 진행상태·리포트 조회.
   *
   * 상사가 자기 프로그램 안에서 리포트를 보려면 이게 있어야 한다. 기존
   * GET /v1/external/request/list?source=... 로도 같은 데이터가 나오지만 그건
   * 인증이 없는 공개 엔드포인트라 상사 제품이 기대서는 안 된다.
   */
  @UseGuards(PartnerOAuthGuard)
  @Get(':partner/inspections')
  async getInspections(
    @Param('partner') partner: string,
    @Query('limit') limit: string | undefined,
    @Req() req: { partnerClient?: PartnerTokenPayload },
  ) {
    assertScope(req.partnerClient, 'inspections:read');

    const take = Math.min(Math.max(Number(limit) || 100, 1), 500);
    // self-{코드}는 발주사가 자기 보유 차량을 자체 처리한 건이다(평가사 방문 없음).
    // 상사 입장에서는 자기가 넣은 건이니 같이 보여준다.
    const bookings = await this.bookingRepository.find({
      where: { source: In([partner, `self-${partner}`]) },
      order: { id: 'DESC' },
      take,
    });

    const inspections = bookings.length
      ? await this.inspectionRepository.find({
          where: { bookingId: In(bookings.map((b) => b.id)) },
          select: ['bookingId', 'carHash', 'mileage'],
        })
      : [];
    const inspectionMap = new Map(inspections.map((i) => [i.bookingId, i]));

    const data = bookings.map((b) => {
      const inspection = inspectionMap.get(b.id);
      return {
        id: b.id,
        carNumber: b.carNumber,
        carModel: b.carModel,
        status: b.status,
        statusLabel: STATUS_LABELS[b.status] ?? b.status,
        preferredDateTime: b.preferredDateTime,
        assignedDriverName: b.assignedDriverName ?? null,
        dealerName: b.dealerName ?? null,
        mileage: inspection?.mileage ?? null,
        // 리포트가 아직 없으면 null — 진단 완료 전이거나 평가사가 제출 전이다
        reportUrl: inspection?.carHash ? `${REPORT_BASE_URL}/${inspection.carHash}` : null,
        createdAt: b.createdAt,
      };
    });

    return { data, count: data.length };
  }

  // 발주사 접수건 중 차량이전·계약상태가 모두 완료되고 계약서 작성자가 기록된 건만 조회.
  //
  // 경로가 'anyone-motors/completed-contracts'에서 ':partner/completed-contracts'로
  // 바뀌었지만, 애니원이 부르는 주소는 전자 그대로 이 패턴에 매칭된다 — 저쪽 코드는
  // 고칠 것이 없다.
  @UseGuards(PartnerOAuthGuard)
  @Get(':partner/completed-contracts')
  async getCompletedContracts(
    @Param('partner') partner: string,
    @Req() req: { partnerClient?: PartnerTokenPayload },
  ) {
    assertScope(req.partnerClient, 'completed-contracts:read');

    const bookings = await this.bookingRepository
      .createQueryBuilder('booking')
      .where('booking.source = :source', { source: partner })
      .andWhere('booking.vehicleTransferred = true')
      .andWhere('booking.contractConfirmed = true')
      .andWhere("booking.contractWriter IS NOT NULL AND booking.contractWriter != ''")
      .orderBy('booking.preferredDateTime', 'DESC')
      .getMany();

    // 진단 리포트는 Booking이 아니라 Inspection 테이블에 있음(bookingId로 연결) —
    // findAll()이 프론트에 carHash를 내려주는 것과 동일한 패턴(bookings.service.ts 참고)
    // 주행거리·차키갯수도 Booking에는 없고 진단 리포트에만 있는 값이라 같이 뽑는다.
    const inspections = bookings.length
      ? await this.inspectionRepository.find({
          where: { bookingId: In(bookings.map((b) => b.id)) },
          select: ['bookingId', 'carHash', 'mileage', 'carStatus'],
        })
      : [];
    const inspectionMap = new Map(inspections.map((i) => [i.bookingId, i]));

    // 차키는 스마트/일반/폴딩/특수로 나눠 저장돼 있어서 총 개수는 합산해야 한다
    // (대시보드 매입 상세의 "차키갯수 2개"와 같은 기준).
    const countKeys = (keys?: { smart?: number; general?: number; folding?: number; special?: number }) => {
      if (!keys) return null;
      return (keys.smart || 0) + (keys.general || 0) + (keys.folding || 0) + (keys.special || 0);
    };

    const data = bookings.map((b) => {
      const inspection = inspectionMap.get(b.id);
      const carHash = inspection?.carHash;
      return {
        id: b.id,
        carNumber: b.carNumber,
        carModel: b.carModel,
        carOwner: b.carOwner,
        dealerName: b.dealerName,
        preferredDateTime: b.preferredDateTime,
        contractWriter: b.contractWriter,
        vehicleTransferred: b.vehicleTransferred,
        contractConfirmed: b.contractConfirmed,
        contractDeposit: b.contractDeposit,
        contractBalance: b.contractBalance,
        purchasePrice: b.purchasePrice,
        // 구전 금액. 위 금액 필드들과 동일하게 "만원" 단위다(20 = 200,000원) —
        // 미입력 건은 null.
        oldDealerFee: b.oldDealerFee,
        status: b.status,
        // 진단 리포트 기준 주행거리(km)와 차키 총 개수. 진단이 아직 없거나 그 항목을
        // 입력하지 않은 건은 null이므로 수신 측에서 null 처리가 필요하다.
        mileage: inspection?.mileage ?? null,
        keyCount: countKeys(inspection?.carStatus?.keys),
        createdAt: b.createdAt,
        reportUrl: carHash ? `${REPORT_BASE_URL}/${carHash}` : null,
      };
    });

    return { data, count: data.length };
  }
}
