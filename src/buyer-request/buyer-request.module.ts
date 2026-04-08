import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BuyerRequest } from './entities/buyer-request.entity';
import { BuyerRequestService } from './buyer-request.service';
import { BuyerRequestController } from './buyer-request.controller';
import { SolapiService } from '../solapi/solapi.service';

@Module({
  imports: [TypeOrmModule.forFeature([BuyerRequest])],
  controllers: [BuyerRequestController],
  providers: [BuyerRequestService, SolapiService],
})
export class BuyerRequestModule {}
