import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientErrorLog } from './client-error-log.entity';
import { ClientErrorLogsService } from './client-error-logs.service';
import { ClientErrorLogsController } from './client-error-logs.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ClientErrorLog])],
  providers: [ClientErrorLogsService],
  controllers: [ClientErrorLogsController],
})
export class ClientErrorLogsModule {}
