import { Module } from '@nestjs/common';
import { CarSpecController } from './car-spec.controller';
import { CarSpecService } from './car-spec.service';

@Module({
  controllers: [CarSpecController],
  providers: [CarSpecService],
})
export class CarSpecModule {}
