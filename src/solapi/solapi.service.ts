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
      const pfId = 'YOUR_PF_ID'; // 이건 카카오 채널 관리자 센터의 고유 ID(PFID)를 넣어야 합니다.

      const response = await this.messageService.sendOne({
        to: to,
        from: senderNumber,
        type: 'ALIMTALK',
        kakaoOptions: {
          pfId: pfId,
          templateId: templateId,
          variables: variables,
        },
      });
      return response;
    } catch (error) {
      console.error('솔라피 발송 에러:', error);
      throw error;
    }
  }
}