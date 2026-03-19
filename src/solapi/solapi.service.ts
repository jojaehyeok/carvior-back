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
            const pfId = this.configService.get<string>('SOLAPI_PF_ID'); // .env에서 가져오기

            const response = await this.messageService.sendOne({
                to: to,
                from: senderNumber,
                type: 'ATA', // 👈 'ALIMTALK'에서 'ATA'로 변경!
                kakaoOptions: {
                    pfId: pfId,
                    templateId: templateId,
                    variables: variables,
                },
            });
            return response;
        } catch (error) {
            // 에러 객체를 더 자세히 찍어보기 위해 수정
            console.error('솔라피 발송 상세 에러:', JSON.stringify(error, null, 2));
            throw error;
        }
    }
}