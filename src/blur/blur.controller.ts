import { Body, Controller, Logger, Post } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BlurService } from './blur.service';

interface CategoryEntry { category: string; count: number }

@Controller('v1/admin/blur')
export class BlurController {
  private readonly logger = new Logger(BlurController.name);

  constructor(
    private readonly blurService: BlurService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Post('photos')
  async blurPhotos(@Body() body: {
    urls: string[];
    storeItemId?: string | number;
    categoryMap?: CategoryEntry[];
  }): Promise<{ ok: boolean; message: string; urls?: string[] }> {
    const urls = Array.isArray(body?.urls) ? body.urls : [];
    const storeItemId = body.storeItemId ? Number(body.storeItemId) : undefined;
    const categoryMap = body.categoryMap;

    // 등록 전 미리보기(스토어 아이템 아직 없음) — 관리자가 결과를 바로 확인/등록해야
    // 하므로 동기 처리해서 블러된 URL을 그대로 반환
    if (!storeItemId) {
      const blurredUrls = await this.blurService.blurPhotoUrls(urls);
      return { ok: true, message: `${urls.length}장 블러 처리 완료`, urls: blurredUrls };
    }

    // 이미 등록된 매물의 사진 재처리는 응답을 기다릴 필요 없어 백그라운드로
    setImmediate(async () => {
      try {
        const blurredUrls = await this.blurService.blurPhotoUrls(urls);

        if (categoryMap?.length) {
          const photos: Record<string, string[]> = {};
          let cursor = 0;
          for (const { category, count } of categoryMap) {
            photos[category] = blurredUrls.slice(cursor, cursor + count);
            cursor += count;
          }
          await this.dataSource.query(
            'UPDATE store_items SET photos = ? WHERE id = ?',
            [JSON.stringify(photos), storeItemId],
          );
          this.logger.log(`[Blur] 아이템 ${storeItemId} 사진 업데이트 완료`);
        }
      } catch (e: any) {
        this.logger.error(`[Blur] 백그라운드 처리 실패: ${e.message}`);
      }
    });

    return { ok: true, message: `${urls.length}장 블러 처리를 시작했습니다.` };
  }
}
