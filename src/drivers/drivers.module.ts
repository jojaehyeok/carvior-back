import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriversService } from './drivers.service';
import { DriversController } from './drivers.controller';
import { Driver } from './entities/driver.entity'; // 엔티티 경로 확인

@Module({
  imports: [
    // ✅ 이 부분이 핵심입니다. Driver 엔티티를 리포지토리로 쓸 수 있게 등록!
    TypeOrmModule.forFeature([Driver]) 
  ],
  controllers: [DriversController],
  providers: [DriversService],
  exports: [DriversService], // AuthModule 등 다른 곳에서 쓸 거라면 수출 필수
})
export class DriversModule {}