import { Body, Controller, Post } from '@nestjs/common';
import { ClassifyService } from './classify.service';

@Controller('classify')
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
    await this.classifyService.saveFeedback(body.imageUrl, body.aiCategory, body.correctCategory);
    return { ok: true };
  }
}
