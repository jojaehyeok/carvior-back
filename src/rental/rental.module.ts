import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RentalListing } from './entities/rental-listing.entity';
import { RentalBid } from './entities/rental-bid.entity';
import { RentalService } from './rental.service';
import { RentalController, RentalBidsAdminController } from './rental.controller';
import { RentalPublicController, MyRentalController } from './rental-public.controller';
import { SolapiService } from '../solapi/solapi.service';

@Module({
  imports: [TypeOrmModule.forFeature([RentalListing, RentalBid])],
  controllers: [RentalController, RentalBidsAdminController, RentalPublicController, MyRentalController],
  providers: [RentalService, SolapiService],
  exports: [RentalService],
})
export class RentalModule {}
