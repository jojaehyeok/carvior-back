import { Module } from '@nestjs/common';
import { BlurService } from './blur.service';
import { BlurController } from './blur.controller';

@Module({
  providers: [BlurService],
  controllers: [BlurController],
  exports: [BlurService],
})
export class BlurModule {}
