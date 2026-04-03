import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClassifyService } from './classify.service';
import { ClassifyController } from './classify.controller';
import { ClassificationFeedback } from './classification-feedback.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ClassificationFeedback])],
  controllers: [ClassifyController],
  providers: [ClassifyService],
  exports: [ClassifyService],
})
export class ClassifyModule {}
