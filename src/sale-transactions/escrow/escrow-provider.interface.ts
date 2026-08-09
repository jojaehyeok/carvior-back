// PG/에스크로 사업자 연동 추상화(스펙 7번) — 실제 연동(12단계) 전까지는 MockEscrowProvider만
// 이 인터페이스를 구현한다. 실제 사업자가 정해지면 이 인터페이스를 구현하는 클래스만 새로
// 추가하고 EscrowModule의 provider 등록만 바꾸면 되도록 설계.
export interface EscrowPaymentResult {
  pgTransactionId: string;
}

export const ESCROW_PROVIDER = 'ESCROW_PROVIDER';

export interface EscrowProvider {
  createPayment(transactionId: number, amount: number): Promise<EscrowPaymentResult>;
  getPaymentStatus(pgTransactionId: string): Promise<string>;
  cancelPayment(pgTransactionId: string): Promise<void>;
  requestRelease(pgTransactionId: string): Promise<void>;
  refund(pgTransactionId: string): Promise<void>;
}
