import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { SaleTransactionsService } from './sale-transactions.service';
import { InternalKeyGuard } from '../store-items/internal-key.guard';

@UseGuards(InternalKeyGuard)
@Controller('v1/admin')
export class SaleTransactionsAdminController {
  constructor(private readonly service: SaleTransactionsService) {}

  @Get('sale-listings/:id/bids')
  findBids(@Param('id') id: string) {
    return this.service.findBidsForAdmin(Number(id));
  }

  // 6~7단계: 차주 승인(관리자 전화확인 대행) 후 낙찰 확정 — Transaction/EscrowPayment 생성
  @Patch('sale-listings/:id/select-winner')
  selectWinner(@Param('id') id: string, @Body('bidId') bidId: number) {
    return this.service.selectWinner(Number(id), Number(bidId));
  }

  @Get('transactions')
  findAll() {
    return this.service.findAllTransactionsAdmin();
  }

  @Get('transactions/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOneTransactionAdmin(Number(id));
  }

  @Patch('transactions/:id/confirm-escrow-paid')
  confirmEscrowPaid(@Param('id') id: string) {
    return this.service.confirmEscrowPaid(Number(id));
  }

  // 차주용 웹 화면이 아직 없어서(6단계 결정과 동일) 관리자가 차주와 통화 후 대신 신청
  @Patch('transactions/:id/transport')
  requestTransport(
    @Param('id') id: string,
    @Body() body: { pickupAddress: string; destinationAddress: string; pickupContact: string; deliveryContact: string; transportFee?: number; payer?: 'SELLER' | 'DEALER' },
  ) {
    return this.service.requestTransport(Number(id), body);
  }

  @Patch('transactions/:id/transport-status')
  updateTransportStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.service.updateTransportStatus(Number(id), status);
  }

  @Patch('transactions/:id/confirm-settlement-release')
  confirmSettlementReleaseRequested(@Param('id') id: string) {
    return this.service.confirmSettlementReleaseRequested(Number(id));
  }

  @Patch('transactions/:id/confirm-seller-paid')
  confirmSellerPaid(@Param('id') id: string) {
    return this.service.confirmSellerPaid(Number(id));
  }
}
