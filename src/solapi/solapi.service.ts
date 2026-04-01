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
    async sendAlimTalk(to: string, variables: { '#{진단사명}': string; '#{진단사연락처}': string; '#{차량번호}': string }) {
        try {
            const templateId = this.configService.get<string>('SOLAPI_TEMPLATE_ID_ASSIGNED');
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

    async sendCompletionAlimTalk(variables: { '#{차량번호}': string; '#{완료시간}': string; '#{예약번호}': string }) {
        try {
            const templateId = this.configService.get<string>('SOLAPI_TEMPLATE_ID_COMPLETED');
            const senderNumber = this.configService.get<string>('SOLAPI_SENDER_NUMBER');
            const pfId = this.configService.get<string>('SOLAPI_PF_ID');
            const recipientNumbers = ['01022856017', '01073709569'];

            console.log('--- 진단완료 알림톡 발송 ---');
            console.log('to:', recipientNumbers);
            console.log('templateId:', templateId);

            const responses = await Promise.all(
                recipientNumbers.map((to) =>
                    this.messageService.sendOne({
                        to,
                        from: senderNumber,
                        type: 'ATA',
                        kakaoOptions: {
                            pfId: pfId,
                            templateId: templateId,
                            variables: variables,
                        },
                    }),
                ),
            );
            return responses;
        } catch (error) {
            console.error('진단완료 알림톡 발송 에러:', JSON.stringify(error, null, 2));
            // 알림톡 실패해도 진단 저장은 성공으로 처리
        }
    }
}