import { Injectable } from '@nestjs/common';
import { BookingsService } from '../bookings/bookings.service';
import { SolapiService } from '../solapi/solapi.service';

// 토스/네이버페이 결제창은 브라우저에서 열리지만, 결제 승인(진짜 결제됐는지 PG사에 확인)은
// 시크릿키가 필요해서 반드시 서버에서 해야 함 — 원래 cavior(Next.js)의 app/api/inspection/confirm*
// 라우트가 이 역할이었는데, Apache가 새/일부 Next 라우트를 화이트리스트에 안 넣어두면 백엔드로
// 요청이 새서 404가 나는 인프라 문제가 있었음(v1/* 만 항상 백엔드로 보장 라우팅됨). 그래서 결제승인
// 로직 자체를 여기(NestJS, v1/*)로 옮김 — 프론트는 이 엔드포인트를 브라우저에서 직접 호출.
//
// env는 반드시 함수 안에서(요청 시점에) 읽어야 함 — 모듈 최상단 const로 읽으면 NestJS가
// ConfigModule(.env 로딩)을 초기화하기 *전에* 이 파일이 먼저 import되면서 process.env가 아직
// 비어있는 시점의 값이 영원히 캐싱돼버림(재시작해도 안 고쳐지는 버그였음 — 직접 겪음).
function tossSecretKey() {
  return process.env.TOSS_SECRET_KEY ?? '';
}
function naverPayConfig() {
  return {
    clientId:     process.env.NAVERPAY_CLIENT_ID ?? process.env.NEXT_PUBLIC_NAVERPAY_CLIENT_ID ?? '',
    clientSecret: process.env.NAVERPAY_CLIENT_SECRET ?? '',
    partnerId:    process.env.NAVERPAY_PARTNER_ID ?? '',
    chainId:      process.env.NAVERPAY_CHAIN_ID ?? '',
    mode:         process.env.NAVERPAY_MODE ?? 'development',
  };
}

interface InspectionOrderPayload {
  source?: string;
  carNumber?: string;
  carModel?: string;
  carOwner?: string;
  contact?: string;
  address?: string;
  detailAddress?: string;
  preferredDateTime?: string;
  email?: string;
  dealerName?: string;
  dealerContact?: string;
  listingUrl?: string;
  carOrigin?: string;
  additionalMemo?: string;
  amount?: number;
}

@Injectable()
export class InspectionPaymentsService {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly solapiService: SolapiService,
  ) {}

  // 승인 성공 시 공용 후처리 — 예약 생성 + 관리자 알림(실패해도 결제 확인 자체는 이미 끝난 것이므로 삼킴)
  private async createBookingAndNotify(
    paymentMethod: string,
    paymentKey: string,
    orderId: string,
    order: InspectionOrderPayload,
  ) {
    const orderPayload = {
      // 딜바타(딜러 앱) 제휴검차처럼 소스 구분이 필요한 호출자는 override 가능 —
      // 안 넘기면 기존 웹 구매동행(/inspection)과 동일하게 CARVIOR_INSPECTION 유지.
      source:            order.source ?? 'CARVIOR_INSPECTION',
      carNumber:         order.carNumber  ?? '',
      carModel:          order.carModel   ?? '',
      carOwner:          order.carOwner   ?? '',
      contact:           order.contact    ?? '',
      address:           order.address    ?? '',
      detailAddress:     order.detailAddress ?? '',
      preferredDateTime: order.preferredDateTime ?? '',
      paymentMethod,
      amount:            order.amount,
      carOrigin:         order.carOrigin ?? null,
      paymentKey,
      orderId,
      email:             order.email ?? '',
      dealerName:        order.dealerName ?? '',
      dealerContact:     order.dealerContact ?? '',
      listingUrl:        order.listingUrl ?? '',
      additionalMemo:    order.additionalMemo ?? '',
    };

    await this.bookingsService.create(orderPayload as any);

    try {
      const amountLabel = order.amount ? `${Number(order.amount).toLocaleString()}원` : '-';
      await this.solapiService.sendSms(
        '01022856017',
        `[카비어]검차결제 ${order.carNumber || '-'} ${order.carOwner || '-'} ${amountLabel}`,
      );
    } catch {
      // SMS 실패해도 예약 접수 자체는 이미 정상 처리됨
    }
  }

  async confirmToss(body: {
    paymentKey: string; orderId: string; amount: number;
  } & InspectionOrderPayload) {
    const { paymentKey, orderId, amount } = body;

    const tossRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${tossSecretKey()}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });
    const data = await tossRes.json();

    if (data.status === 'DONE') {
      await this.createBookingAndNotify('TOSS_TRANSFER', paymentKey, orderId, { ...body, amount });
    }

    return data;
  }

  async confirmNaverPay(body: {
    paymentId: string; merchantPayKey: string; amount: number;
  } & InspectionOrderPayload) {
    const { paymentId, merchantPayKey, amount } = body;
    const { clientId, clientSecret, partnerId, chainId, mode } = naverPayConfig();

    if (!clientSecret || !partnerId) {
      // 가맹점 승인 전(진짜 키가 아직 없음) — 여기서 실패시켜 "결제 안 됐는데 접수된" 사고를 막는다.
      return { code: 'Fail', message: '네이버페이 가맹점 승인이 아직 완료되지 않았습니다.' };
    }

    const host = mode === 'production' ? 'apis.naver.com' : 'dev.apis.naver.com';
    const url  = `https://${host}/${partnerId}/naverpay/payments/v2.2/apply/payment?paymentId=${encodeURIComponent(paymentId)}`;

    const npRes = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
        ...(chainId ? { 'X-NaverPay-Chain-Id': chainId } : {}),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ paymentId }).toString(),
    });
    const data = await npRes.json();

    if (data?.code === 'Success') {
      await this.createBookingAndNotify('NAVERPAY', paymentId, merchantPayKey, { ...body, amount });
    }

    return data;
  }
}
