import { Body, Controller, Post } from '@nestjs/common';
import { BlurService } from './blur.service';

@Controller('v1/admin/blur')
export class BlurController {
  constructor(private readonly blurService: BlurService) {}

  @Post('photos')
  async blurPhotos(@Body() body: { urls: string[] }): Promise<{ urls: string[] }> {
    const urls = Array.isArray(body?.urls) ? body.urls : [];
    const blurred = await this.blurService.blurPhotoUrls(urls);
    return { urls: blurred };
  }
}
