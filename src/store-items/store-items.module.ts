import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreItem } from './entities/store-item.entity';
import { StoreItemsService } from './store-items.service';
import { StoreItemsController } from './store-items.controller';
import { SolapiService } from '../solapi/solapi.service';
import { BlurModule } from '../blur/blur.module';
import { ComplianceModule } from '../compliance/compliance.module';

@Module({
  imports: [TypeOrmModule.forFeature([StoreItem]), BlurModule, ComplianceModule],
  controllers: [StoreItemsController],
  providers: [StoreItemsService, SolapiService],
  exports: [StoreItemsService],
})
export class StoreItemsModule {}
