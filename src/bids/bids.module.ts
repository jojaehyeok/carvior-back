import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bid } from './entities/bid.entity';
import { StoreItem } from '../store-items/entities/store-item.entity';
import { User } from '../users/entities/user.entity';
import { BidsService } from './bids.service';
import { BidsController } from './bids.controller';
import { SolapiService } from '../solapi/solapi.service';
import { DealerPenaltiesModule } from '../dealer-penalties/dealer-penalties.module';
import { WinnerConfirmationPenaltyService } from './winner-confirmation-penalty.service';
import { NotificationsService } from '../notifications/notifications.service';

@Module({
  imports: [TypeOrmModule.forFeature([Bid, StoreItem, User]), DealerPenaltiesModule],
  controllers: [BidsController],
  providers: [BidsService, SolapiService, WinnerConfirmationPenaltyService, NotificationsService],
  exports: [BidsService],
})
export class BidsModule {}
