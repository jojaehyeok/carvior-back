import { Body, Controller, Post } from '@nestjs/common';
import { ClassifyService } from './classify.service';

@Controller('v1/classify')
export class ClassifyController {
  constructor(private readonly classifyService: ClassifyService) {}

  @Post('photo')
  async classifyPhoto(@Body() body: { imageUrl: string }) {
    return this.classifyService.classifyPhoto(body.imageUrl);
  }

  @Post('feedback')
  async submitFeedback(
    @Body() body: { imageUrl: string; aiCategory: string; correctCategory: string },
  ) {
    console.log('[피드백 수신]', JSON.stringify(body));
    if (!body.imageUrl || !body.aiCategory || !body.correctCategory) {
      console.warn('[피드백 누락] 필드 없음:', JSON.stringify(body));
      return { ok: false, reason: 'missing fields' };
    }
    if (!body.imageUrl.startsWith('http')) {
      console.warn('[피드백 무시] 로컬 URI (S3 아님):', body.imageUrl.substring(0, 60));
      return { ok: false, reason: 'not s3 url' };
    }
    await this.classifyService.saveFeedback(body.imageUrl, body.aiCategory, body.correctCategory);
    console.log('[피드백 저장 완료]', body.aiCategory, '→', body.correctCategory);
    return { ok: true };
  }
}
