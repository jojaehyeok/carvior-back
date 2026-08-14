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
    // 미배정 신규요청 브로드캐스트("도착했습니다")처럼 기본음과 달라야 할 때만 넘김 —
    // 안 넘기면 기본음("배정되었습니다")을 씀. 배정 관련 알림(자동/수동/에이전트 배정, 재배정 등)은
    // 전부 이 기본값을 그대로 타므로 따로 넘길 필요 없음.
    channel?: { channelId: string; sound: string },
  ) {
    if (!pushToken) return;
    const channelId = channel?.channelId ?? 'cavior-auto-assigned';
    const sound = channel?.sound ?? 'carvior_auto_assigned';

    // FCM v1 (네이티브 빌드 토큰)
    if (this.fcmReady && !pushToken.startsWith('ExponentPushToken')) {
      try {
        await admin.messaging().send({
          token: pushToken,
          notification: { title, body },
          android: {
            priority: 'high',
            notification: {
              sound,
              channelId,
            },
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
            sound,
            channelId,
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
