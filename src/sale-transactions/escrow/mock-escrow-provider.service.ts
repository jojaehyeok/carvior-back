import { Injectable } from '@nestjs/common';
import { EscrowPaymentResult, EscrowProvider } from './escrow-provider.interface';

// 실제 PG/에스크로 사업자 계약 전까지 쓰는 가짜 구현체 — 카비어 자체 DB에 돈을 보관하지
// 않는다는 원칙을 지키면서도 전체 거래 흐름(입찰→낙찰→에스크로→탁송→정산)을 지금 바로
// 개발/테스트할 수 있게 해준다. 실제 상태 전이는 관리자가 대시보드에서 수동 확인하는 방식을
// 그대로 따르고(이 프로젝트의 기존 확인 패턴과 동일), 이 클래스는 pgTransactionId 채번 정도만
// 담당한다.
@Injectable()
export class MockEscrowProvider implements EscrowProvider {
  async createPayment(transactionId: number, amount: number): Promise<EscrowPaymentResult> {
    return { pgTransactionId: `MOCK-${transactionId}-${Date.now()}` };
  }

  async getPaymentStatus(_pgTransactionId: string): Promise<string> {
    return 'PAID_TO_ESCROW';
  }

  async cancelPayment(_pgTransactionId: string): Promise<void> {}

  async requestRelease(_pgTransactionId: string): Promise<void> {}

  async refund(_pgTransactionId: string): Promise<void> {}
}
