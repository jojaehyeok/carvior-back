import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SaleListing } from './entities/sale-listing.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { SaleListingsService } from './sale-listings.service';
import { SaleListingsController } from './sale-listings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SaleListing, Vehicle])],
  controllers: [SaleListingsController],
  providers: [SaleListingsService],
  exports: [SaleListingsService],
})
export class SaleListingsModule {}
