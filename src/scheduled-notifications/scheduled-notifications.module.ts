import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduledNotification } from './scheduled-notification.entity';
import { ScheduledNotificationsService } from './scheduled-notifications.service';
import { SolapiService } from 'src/solapi/solapi.service';

@Module({
  imports: [TypeOrmModule.forFeature([ScheduledNotification])],
  providers: [ScheduledNotificationsService, SolapiService],
  exports: [ScheduledNotificationsService],
})
export class ScheduledNotificationsModule {}
