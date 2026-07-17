import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bid } from './entities/bid.entity';
import { StoreItem } from '../store-items/entities/store-item.entity';
import { User } from '../users/entities/user.entity';
import { BidsService } from './bids.service';
import { BidsController } from './bids.controller';
import { SolapiService } from '../solapi/solapi.service';

@Module({
  imports: [TypeOrmModule.forFeature([Bid, StoreItem, User])],
  controllers: [BidsController],
  providers: [BidsService, SolapiService],
  exports: [BidsService],
})
export class BidsModule {}
