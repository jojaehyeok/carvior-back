import { Body, Controller, Post } from '@nestjs/common';
import { ClassifyService } from './classify.service';

@Controller('classify')
export class ClassifyController {
  constructor(private readonly classifyService: ClassifyService) {}

  @Post('photo')
  async classifyPhoto(@Body() body: { imageUrl: string }) {
    return this.classifyService.classifyPhoto(body.imageUrl);
  }
}
