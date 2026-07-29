import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ScheduledNotification } from './scheduled-notification.entity';
import { SolapiService } from 'src/solapi/solapi.service';

@Injectable()
export class ScheduledNotificationsService {
  private readonly logger = new Logger(ScheduledNotificationsService.name);

  constructor(
    @InjectRepository(ScheduledNotification)
    private readonly repo: Repository<ScheduledNotification>,
    private readonly solapiService: SolapiService,
  ) {}

  // delayMs 뒤에 보내도록 DB에 기록만 해둔다 — 실제 발송은 크론잡이 처리
  async schedule(params: {
    type: string;
    recipientPhone: string;
    variables: Record<string, string>;
    delayMs: number;
  }) {
    const row = this.repo.create({
      type: params.type,
      recipientPhone: params.recipientPhone,
      variables: params.variables,
      sendAt: new Date(Date.now() + params.delayMs),
    });
    await this.repo.save(row);
    this.logger.log(`[예약알림] 등록 - ${params.type} → ${params.recipientPhone} @ ${row.sendAt.toISOString()}`);
  }

  // 5분마다 도착한 예약 건을 찾아서 발송 — setTimeout 대신 DB+크론이라 서버 재시작에도 안전
  @Cron(CronExpression.EVERY_5_MINUTES)
  async processDue() {
    const due = await this.repo.find({
      where: { sent: false, sendAt: LessThanOrEqual(new Date()) },
    });
    if (due.length === 0) return;

    this.logger.log(`[예약알림] 발송 대상 ${due.length}건 처리 시작`);
    for (const row of due) {
      try {
        await this.solapiService.sendCompletionAlimTalkTo(
          row.recipientPhone,
          row.variables as { '#{차량번호}': string; '#{완료시간}': string; '#{예약번호}': string; '#{딜러명}'?: string; '#{진단사명}'?: string },
        );
        row.sent = true;
        row.sentAt = new Date();
        await this.repo.save(row);
        this.logger.log(`[예약알림] 발송 완료 - id=${row.id} → ${row.recipientPhone}`);
      } catch (e) {
        row.error = e instanceof Error ? e.message : String(e);
        await this.repo.save(row);
        this.logger.error(`[예약알림] 발송 실패 - id=${row.id}: ${row.error}`);
      }
    }
  }
}
