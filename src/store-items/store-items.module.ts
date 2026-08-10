import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreItem } from './entities/store-item.entity';
import { StoreItemsService } from './store-items.service';
import { StoreItemsController } from './store-items.controller';
import { StoreItemsPublicController } from './store-items-public.controller';
import { StoreItemsExternalController } from './store-items-external.controller';
import { AuctionDeadlineNotifierService } from './auction-deadline-notifier.service';
import { SolapiService } from '../solapi/solapi.service';
import { S3Service } from '../s3/s3.service';
import { BlurModule } from '../blur/blur.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { BidsModule } from '../bids/bids.module';

@Module({
  imports: [TypeOrmModule.forFeature([StoreItem]), BlurModule, ComplianceModule, BidsModule],
  controllers: [StoreItemsController, StoreItemsPublicController, StoreItemsExternalController],
  providers: [StoreItemsService, SolapiService, S3Service, AuctionDeadlineNotifierService],
  exports: [StoreItemsService],
})
export class StoreItemsModule {}
