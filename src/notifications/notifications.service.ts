import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private fcmReady = false;

  onModuleInit() {
    try {
      const keyPath = path.join(process.cwd(), 'firebase-adminsdk.json');
      if (!fs.existsSync(keyPath)) {
        this.logger.warn('firebase-adminsdk.json 없음 → FCM 비활성화');
        return;
      }
      if (admin.apps.length === 0) {
        admin.initializeApp({
          credential: admin.credential.cert(keyPath),
        });
      }
      this.fcmReady = true;
      this.logger.log('FCM 초기화 완료');
    } catch (e) {
      this.logger.error('FCM 초기화 실패', e);
    }
  }

  async sendPush(
    pushToken: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ) {
    if (!pushToken) return;

    // FCM v1 (네이티브 빌드 토큰)
    if (this.fcmReady && !pushToken.startsWith('ExponentPushToken')) {
      try {
        await admin.messaging().send({
          token: pushToken,
          notification: { title, body },
          android: {
            priority: 'high',
            notification: { sound: 'default' },
          },
          data: data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : {},
        });
        this.logger.log(`[FCM] 발송 성공 → ${pushToken.slice(0, 20)}...`);
      } catch (e) {
        this.logger.error(`[FCM] 발송 실패: ${e.message}`);
      }
      return;
    }

    // Expo Push (ExponentPushToken 형태)
    if (pushToken.startsWith('ExponentPushToken')) {
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
          this.logger.error(`[Expo Push] 실패: ${json.data.message}`);
        } else {
          this.logger.log(`[Expo Push] 발송 성공 → ${pushToken.slice(0, 30)}...`);
        }
      } catch (e) {
        this.logger.error('[Expo Push] 오류', e);
      }
    }
  }
}
