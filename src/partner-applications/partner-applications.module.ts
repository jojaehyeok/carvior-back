import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PartnerApplication } from './entities/partner-application.entity';
import { PartnerApplicationsService } from './partner-applications.service';
import { PartnerApplicationsController } from './partner-applications.controller';
import { SolapiService } from '../solapi/solapi.service';

@Module({
  imports: [TypeOrmModule.forFeature([PartnerApplication])],
  controllers: [PartnerApplicationsController],
  providers: [PartnerApplicationsService, SolapiService],
})
export class PartnerApplicationsModule {}
