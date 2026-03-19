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

    async sendAlimTalk(to: string, variables: any) {
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
}