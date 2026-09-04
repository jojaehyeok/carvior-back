import { Body, Controller, Get, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { In, Repository } from 'typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { Inspection } from '../inspection/entities/inspection.entity';
import { PartnerOAuthGuard } from './partner-oauth.guard';

const REPORT_BASE_URL = 'https://carvior.store/car-report';

interface TokenRequestBody {
  grant_type?: string;
  client_id?: string;
  client_secret?: string;
}

@Controller('v1/partner-api')
export class PartnerApiController {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(Inspection)
    private readonly inspectionRepository: Repository<Inspection>,
    private readonly jwt: JwtService,
  ) {}

  // RFC 6749 client_credentials 그랜트 — 애니원모터스 쪽 시스템이 client_id/secret으로
  // access token을 발급받는 엔드포인트. 지금은 발주사 1곳만 대상이라 클라이언트 정보를
  // DB 대신 env로 관리(ANYONE_MOTORS_CLIENT_ID/SECRET) — 파트너가 늘어나면 그때 테이블로 옮기면 됨.
  @Post('oauth/token')
  issueToken(@Body() body: TokenRequestBody) {
    const { grant_type, client_id, client_secret } = body;
    if (grant_type !== 'client_credentials') {
      throw new UnauthorizedException({ error: 'unsupported_grant_type' });
    }
    if (
      !client_id ||
      !client_secret ||
      client_id !== process.env.ANYONE_MOTORS_CLIENT_ID ||
      client_secret !== process.env.ANYONE_MOTORS_CLIENT_SECRET
    ) {
      throw new UnauthorizedException({ error: 'invalid_client' });
    }

    const access_token = this.jwt.sign({ sub: 'anyone-motors', scope: 'completed-contracts:read' });
    return { access_token, token_type: 'Bearer', expires_in: 3600 };
  }

  // 애니원모터스 접수건 중 차량이전·계약상태가 모두 완료되고 계약서 작성자가 기록된 건만 조회
  @UseGuards(PartnerOAuthGuard)
  @Get('anyone-motors/completed-contracts')
  async getCompletedContracts() {
    const bookings = await this.bookingRepository
      .createQueryBuilder('booking')
      .where('booking.source = :source', { source: 'anyone-motors' })
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
