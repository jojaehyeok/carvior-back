import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettlementExtraCost } from './entities/settlement-extra-cost.entity';
import { SettlementExtraCostService } from './settlement-extra-cost.service';
import { SettlementExtraCostController } from './settlement-extra-cost.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SettlementExtraCost])],
  controllers: [SettlementExtraCostController],
  providers: [SettlementExtraCostService],
})
export class SettlementExtraCostModule {}
