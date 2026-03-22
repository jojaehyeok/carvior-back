import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriversService } from './drivers.service';
import { DriversController } from './drivers.controller';
import { Driver } from './entities/driver.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Driver])], // ✅ Driver 엔티티 등록
  controllers: [DriversController],
  providers: [DriversService],
  exports: [DriversService], // 다른 모듈(Auth 등)에서 쓸 수 있게 수출
})
export class DriversModule {}