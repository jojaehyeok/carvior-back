import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  async sendPush(
    pushToken: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ) {
    if (!pushToken?.startsWith('ExponentPushToken')) return;

    try {
      const res = await fetch('https://exp.host/--/expoapi/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify({
          to: pushToken,
          sound: 'default',
          title,
          body,
          data: data ?? {},
          priority: 'high',
        }),
      });

      const json = await res.json() as any;
      if (json?.data?.status === 'error') {
        this.logger.error(`Push 발송 실패: ${json.data.message}`);
      } else {
        this.logger.log(`Push 발송 성공 → ${pushToken.slice(0, 30)}...`);
      }
    } catch (e) {
      this.logger.error('Push 발송 중 오류', e);
    }
  }
}
