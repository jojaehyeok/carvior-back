import { Module } from '@nestjs/common';
import { CarSpecController } from './car-spec.controller';
import { CarSpecService } from './car-spec.service';

@Module({
  controllers: [CarSpecController],
  providers: [CarSpecService],
  // 접수(bookings)에서 매물 참고자료를 당길 때 쓴다
  exports: [CarSpecService],
})
export class CarSpecModule {}
