import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlurController } from './blur.controller';
import { BlurService } from './blur.service';

@Module({
  imports: [TypeOrmModule.forFeature([])],
  providers: [BlurService],
  controllers: [BlurController],
  exports: [BlurService],
})
export class BlurModule {}
