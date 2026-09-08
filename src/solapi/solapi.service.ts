import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
const { SolapiMessageService } = require('solapi');

@Injectable()
export class SolapiService {
    private messageService;

    constructor(private configService: ConfigService) {
        // .env에서 키 가져오기
        const apiKey = this.configService.get<string>('SOLAPI_API_KEY');
        const apiSecret = this.configService.get<string>('SOLAPI_API_SECRET');
        this.messageService = new SolapiMessageService(apiKey, apiSecret);
    }

    // 진단사 배정 알림 (고객에게 발송)
    //
    // 평가 차량번호·진단일시를 넣은 새 템플릿은 카카오 재심사를 받아야 해서, 승인 전에는
    // SOLAPI_TEMPLATE_ID_ASSIGNED_V2가 비어 있다 — 그 동안은 기존 템플릿(변수 3개)으로
    // 그대로 나가게 두고, .env에 새 ID를 넣는 순간 자동으로 5개짜리로 바뀐다.
    // 변수 개수가 템플릿과 다르면 솔라피가 발송을 거부하므로 반드시 짝을 맞춰 보낸다.
    async sendAlimTalk(to: string, variables: { '#{진단사명}': string; '#{진단사연락처}': string; '#{차량번호}': string; '#{평가차량}'?: string; '#{진단일시}'?: string }) {
        try {
            const v2Id = this.configService.get<string>('SOLAPI_TEMPLATE_ID_ASSIGNED_V2');
            const templateId = v2Id || this.configService.get<string>('SOLAPI_TEMPLATE_ID_ASSIGNED');
            if (!v2Id) {
                delete variables['#{평가차량}'];
                delete variables['#{진단일시}'];
            }
            const senderNumber = this.configService.get<string>('SOLAPI_SENDER_NUMBER');
            const pfId = this.configService.get<string>('SOLAPI_PF_ID');

            // 🚨 로그 추가: 값이 undefined라면 .env를 못 읽는 것임
            console.log('--- 솔라피 설정값 확인 ---');
            console.log('pfId:', pfId);
            console.log('templateId:', templateId);
            console.log('senderNumber:', senderNumber);

            if (!pfId) {
                throw new Error('PF_ID가 설정되지 않았습니다. .env 파일을 확인하세요.');
            }

            const response = await this.messageService.sendOne({
                to: to,
                from: senderNumber,
                type: 'ATA',
                kakaoOptions: {
                    pfId: pfId,
                    templateId: templateId,
                    variables: variables,
                },
            });
            return response;
        } catch (error) {
            console.error('솔라피 발송 상세 에러:', JSON.stringify(error, null, 2));
            throw error;
        }
    }

    // 진단 예약신청 알림 (딜러에게 발송)
    async sendReservationAlimTalk(to: string, variables: { '#{dealerName}': string; '#{carNumber}': string; '#{carOwner}': string; '#{preferredDate}': string; '#{createdAt}': string }) {
        try {
            const templateId = this.configService.get<string>('SOLAPI_TEMPLATE_ID_RESERVATION');
            const senderNumber = this.configService.get<string>('SOLAPI_SENDER_NUMBER');
            const pfId = this.configService.get<string>('SOLAPI_PF_ID');

            console.log('--- 진단예약신청 알림톡 발송 ---');
            console.log('to:', to);
            console.log('templateId:', templateId);

            const response = await this.messageService.sendOne({
                to,
                from: senderNumber,
                type: 'ATA',
                kakaoOptions: { pfId, templateId, variables },
            });
            return response;
        } catch (error) {
            console.error('진단예약신청 알림톡 발송 에러:', JSON.stringify(error, null, 2));
            throw error;
        }
    }

    // 대기중 알림 (고객에게 발송)
    async sendWaitingAlimTalk(to: string, variables: { '#{고객명}': string; '#{차량번호}': string; '#{상태}': string }) {
        try {
            const templateId = this.configService.get<string>('SOLAPI_TEMPLATE_ID_WAITING');
            const senderNumber = this.configService.get<string>('SOLAPI_SENDER_NUMBER');
            const pfId = this.configService.get<string>('SOLAPI_PF_ID');

            console.log('--- 대기중 알림톡 발송 ---');
            console.log('to:', to);
            console.log('templateId:', templateId);

            const response = await this.messageService.sendOne({
                to,
                from: senderNumber,
                type: 'ATA',
                kakaoOptions: { pfId, templateId, variables },
            });
            return response;
        } catch (error) {
            console.error('대기중 알림톡 발송 에러:', JSON.stringify(error, null, 2));
            throw error;
        }
    }

    // 신청취소 알림 (고객에게 발송)
    async sendCancelAlimTalk(to: string, variables: { '#{차량번호}': string; '#{취소사유}': string }) {
        try {
            const templateId = this.configService.get<string>('SOLAPI_TEMPLATE_ID_CANCEL');
            const senderNumber = this.configService.get<string>('SOLAPI_SENDER_NUMBER');
            const pfId = this.configService.get<string>('SOLAPI_PF_ID');

            console.log('--- 신청취소 알림톡 발송 ---');
            console.log('to:', to);
            console.log('templateId:', templateId);

            const response = await this.messageService.sendOne({
                to,
                from: senderNumber,
                type: 'ATA',
                kakaoOptions: { pfId, templateId, variables },
            });
            return response;
        } catch (error) {
            console.error('신청취소 알림톡 발송 에러:', JSON.stringify(error, null, 2));
            throw error;
        }
    }

    // 진단 배정 알림 (평가사 본인에게 발송) — 자동배정 건에만 사용. 앱 푸시는 평가사가 안 볼 수도
    // 있어서, 놓치기 쉬운 자동배정 건만 카카오톡으로 한 번 더 알려준다(수동/에이전트 배정은 대상 아님).
    async sendDriverAssignmentAlimTalk(to: string, variables: { '#{평가사명}': string; '#{상대명}': string; '#{연락처}': string; '#{진단일시}': string; '#{총진단건수}': string }) {
        try {
            const templateId = this.configService.get<string>('SOLAPI_TEMPLATE_ID_DRIVER_ASSIGNMENT');
            const senderNumber = this.configService.get<string>('SOLAPI_SENDER_NUMBER');
            const pfId = this.configService.get<string>('SOLAPI_PF_ID');

            console.log('--- 진단 배정 알림톡(평가사) 발송 ---');
            console.log('to:', to);
            console.log('templateId:', templateId);

            const response = await this.messageService.sendOne({
                to,
                from: senderNumber,
                type: 'ATA',
                kakaoOptions: { pfId, templateId, variables },
            });
            return response;
        } catch (error) {
            console.error('진단 배정 알림톡(평가사) 발송 에러:', JSON.stringify(error, null, 2));
            throw error;
        }
    }

    // 진단 예약일시 변경 알림 (신청자에게 발송)
    //
    // 관리자가 대시보드에서 방문 일시를 바꾸면 신청한 쪽(딜러 또는 고객 본인)이 모른 채
    // 원래 시간에 기다리는 일이 있어서 만든 알림이다. 카카오 템플릿 승인 전에는
    // SOLAPI_TEMPLATE_ID_SCHEDULE_CHANGED가 비어 있으므로 조용히 건너뛴다(발송 실패 로그로
    // 도배되지 않게 — 승인되면 .env에 ID만 넣으면 바로 나간다).
    async sendScheduleChangedAlimTalk(
        to: string,
        variables: { '#{차량번호}': string; '#{진단사명}': string; '#{평가차량}': string; '#{변경전일시}': string; '#{변경후일시}': string },
    ) {
        const templateId = this.configService.get<string>('SOLAPI_TEMPLATE_ID_SCHEDULE_CHANGED');
        if (!templateId) {
            console.log('🔕 [예약변경 알림톡 생략] SOLAPI_TEMPLATE_ID_SCHEDULE_CHANGED 미설정 — 템플릿 승인 후 .env에 추가 필요');
            return null;
        }
        const senderNumber = this.configService.get<string>('SOLAPI_SENDER_NUMBER');
        const pfId = this.configService.get<string>('SOLAPI_PF_ID');

        try {
            const response = await this.messageService.sendOne({
                to,
                from: senderNumber,
                type: 'ATA',
                kakaoOptions: { pfId, templateId, variables },
            });
            console.log(`✅ [예약변경 알림톡] → ${to} (${variables['#{차량번호}']})`);
            return response;
        } catch (error) {
            console.error('예약변경 알림톡 발송 에러:', JSON.stringify(error, null, 2));
            throw error;
        }
    }

    async sendSms(to: string, text: string) {
        try {
            const senderNumber = this.configService.get<string>('SOLAPI_SENDER_NUMBER');
            // SMS는 90byte 제한(한글 EUC-KR 기준 약 2byte/자) — 초과하면 접수 자체가 거부됨.
            // LMS는 비용이 더 들어서 일단은 안 씀 — 호출부에서 90byte 안으로 메시지를 줄여서 보내야 함
            await this.messageService.sendOne({ to, from: senderNumber, type: 'SMS', text });
            console.log(`[SMS 발송] → ${to} (${Buffer.byteLength(text, 'utf-8')}byte)`);
        } catch (error) {
            console.error('[SMS 발송 실패]', JSON.stringify(error, null, 2));
            // 조용히 삼키면 호출부가 "성공"으로 착각함 — 실패는 호출부가 판단해서 처리하도록 다시 던짐
            throw error;
        }
    }

    // 완료 알림톡을 임의의 한 번호로 보낸다 — 즉시 발송/예약 발송(크론) 둘 다 이걸 재사용
    async sendCompletionAlimTalkTo(to: string, variables: { '#{차량번호}': string; '#{완료시간}': string; '#{예약번호}': string; '#{딜러명}'?: string; '#{진단사명}'?: string }) {
        const templateId = this.configService.get<string>('SOLAPI_TEMPLATE_ID_COMPLETED');
        const senderNumber = this.configService.get<string>('SOLAPI_SENDER_NUMBER');
        const pfId = this.configService.get<string>('SOLAPI_PF_ID');

        return this.messageService.sendOne({
            to,
            from: senderNumber,
            type: 'ATA',
            kakaoOptions: { pfId, templateId, variables },
        });
    }

    // 대표님께는 즉시 발송. 협업 파트너사(Anyone모터스 등)는 1시간 지연 발송이 필요해서
    // ScheduledNotificationsService가 별도로 예약 처리한다(inspection.service.ts 참고).
    async sendCompletionAlimTalk(variables: { '#{차량번호}': string; '#{완료시간}': string; '#{예약번호}': string; '#{딜러명}'?: string; '#{진단사명}'?: string }, source?: string) {
        try {
            console.log('--- 진단완료 알림톡 발송(즉시) ---');
            const response = await this.sendCompletionAlimTalkTo('01022856017', variables);
            return [response];
        } catch (error) {
            console.error('진단완료 알림톡 발송 에러:', JSON.stringify(error, null, 2));
            // 알림톡 실패해도 진단 저장은 성공으로 처리
        }
    }
}