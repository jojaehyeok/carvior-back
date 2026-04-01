import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DriversService } from './drivers.service';
import { DriversController } from './drivers.controller';
import { Driver } from './entities/driver.entity';
import { S3Service } from '../s3/s3.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Driver]),
    ConfigModule,
  ],
  controllers: [DriversController],
  providers: [DriversService, S3Service],
  exports: [DriversService],
})
export class DriversModule {}
