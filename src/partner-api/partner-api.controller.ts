import { Body, Controller, Get, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { PartnerOAuthGuard } from './partner-oauth.guard';

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

    const data = bookings.map((b) => ({
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
      status: b.status,
      createdAt: b.createdAt,
    }));

    return { data, count: data.length };
  }
}
