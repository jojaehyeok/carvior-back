import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreItem } from './entities/store-item.entity';
import { StoreItemsService } from './store-items.service';
import { StoreItemsController } from './store-items.controller';
import { SolapiService } from '../solapi/solapi.service';

@Module({
  imports: [TypeOrmModule.forFeature([StoreItem])],
  controllers: [StoreItemsController],
  providers: [StoreItemsService, SolapiService],
  exports: [StoreItemsService],
})
export class StoreItemsModule {}
