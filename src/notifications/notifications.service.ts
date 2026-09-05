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

  // 관리자 대시보드(웹 브라우저)용 발송. 앱 푸시(sendPush)와 달리 android 채널/소리 대신
  // webpush 설정을 쓴다 — link를 넣어야 알림을 클릭했을 때 해당 화면으로 이동한다.
  // 브라우저가 완전히 종료돼 있으면 서비스워커도 안 살아 있어서 알림이 도착하지 않는다(브라우저 제약).
  async sendWebPush(
    webPushToken: string,
    title: string,
    body: string,
    link?: string,
    data?: Record<string, unknown>,
  ) {
    if (!webPushToken || !this.fcmReady) return;
    try {
      await admin.messaging().send({
        token: webPushToken,
        notification: { title, body },
        webpush: {
          notification: {
            title,
            body,
            icon: '/admin/android-chrome-192x192.png',
            badge: '/admin/favicon-32x32.png',
            // 여기에 tag / requireInteraction / actions를 얹었다가 배너가 아예 안 뜨는 사고가
            // 났다. 서비스워커는 메시지를 받고 showNotification도 예외 없이 통과하는데 화면에만
            // 안 나타나서 원인 찾기가 오래 걸렸다(같은 tag는 배너 없이 조용히 교체되고,
            // requireInteraction으로 이전 알림이 안 사라져 그 자리를 계속 점유했다).
            // 알림이 뜨는 게 먼저다 — 옵션은 전부 빼고 제목·본문·아이콘만 보낸다.
            // 다시 붙일 땐 한 번에 하나씩만 넣고 실기기에서 확인할 것.
          },
          fcmOptions: link ? { link } : undefined,
        },
        data: data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : {},
      });
      this.logger.log(`[FCM-Web] 발송 성공 → ${webPushToken.slice(0, 20)}...`);
    } catch (e) {
      // 토큰이 만료·폐기되면(브라우저 데이터 삭제 등) 실패한다 — 발송 실패가 본 작업(매입가 저장)을
      // 막으면 안 되므로 로그만 남긴다.
      this.logger.error(`[FCM-Web] 발송 실패: ${e.message}`);
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
