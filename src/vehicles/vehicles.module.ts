import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vehicle } from './entities/vehicle.entity';
import { VehiclesService } from './vehicles.service';
import { VehiclesController } from './vehicles.controller';
import { SaleListingsModule } from '../sale-listings/sale-listings.module';

@Module({
  imports: [TypeOrmModule.forFeature([Vehicle]), SaleListingsModule],
  controllers: [VehiclesController],
  providers: [VehiclesService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
