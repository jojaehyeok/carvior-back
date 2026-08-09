import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SaleBid } from './entities/sale-bid.entity';
import { Transaction } from './entities/transaction.entity';
import { EscrowPayment } from './entities/escrow-payment.entity';
import { SaleTransport } from './entities/sale-transport.entity';
import { Settlement } from './entities/settlement.entity';
import { SaleListing } from '../sale-listings/entities/sale-listing.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { SaleTransactionsService } from './sale-transactions.service';
import { SaleTransactionsAdminController } from './sale-transactions-admin.controller';
import { SaleTransactionsExternalController } from './sale-transactions-external.controller';
import { ESCROW_PROVIDER } from './escrow/escrow-provider.interface';
import { MockEscrowProvider } from './escrow/mock-escrow-provider.service';

@Module({
  imports: [TypeOrmModule.forFeature([SaleBid, Transaction, EscrowPayment, SaleTransport, Settlement, SaleListing, Vehicle])],
  controllers: [SaleTransactionsAdminController, SaleTransactionsExternalController],
  providers: [
    SaleTransactionsService,
    { provide: ESCROW_PROVIDER, useClass: MockEscrowProvider },
  ],
})
export class SaleTransactionsModule {}
