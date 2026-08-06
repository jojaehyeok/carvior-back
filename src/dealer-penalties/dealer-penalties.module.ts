import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DealerPenalty } from './dealer-penalty.entity';
import { DealerPenaltiesService } from './dealer-penalties.service';

@Module({
  imports: [TypeOrmModule.forFeature([DealerPenalty])],
  providers: [DealerPenaltiesService],
  exports: [DealerPenaltiesService],
})
export class DealerPenaltiesModule {}
