import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors, UploadedFile, NotFoundException, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { StoreItemsService } from './store-items.service';
import { StoreItem } from './entities/store-item.entity';
import { SolapiService } from '../solapi/solapi.service';
import { BlurService } from '../blur/blur.service';
import { S3Service } from '../s3/s3.service';
import { InternalKeyGuard } from './internal-key.guard';

@Controller('v1/admin/store-items')
export class StoreItemsController {
  constructor(
    private readonly service: StoreItemsService,
    private readonly solapiService: SolapiService,
    private readonly blurService: BlurService,
    private readonly s3Service: S3Service,
  ) {}

  @Get()
  @UseGuards(InternalKeyGuard)
  findAll() {
    return this.service.findAll();
  }

  @Get('my')
  findByUser(@Query('userId') userId: string) {
    return this.service.findByUser(Number(userId));
  }

  @Get(':id')
  @UseGuards(InternalKeyGuard)
  findOne(@Param('id') id: string) {
    return this.service.findOne(Number(id));
  }

  @Post()
  async create(@Body() body: Partial<StoreItem>) {
    const item = await this.service.create(body);

    // 관리자 알림 SMS
    try {
      const priceMan = item.priceKRW ? Math.round(Number(item.priceKRW) / 10_000) : 0;
      const contact = item.adminMemo?.match(/연락처:([^\s/\n]+)/)?.[1]?.trim() ?? '';
      const msg = `[카비어]${item.carNumber} ${priceMan}만 ${contact}`;
      await this.solapiService.sendSms('01022856017', msg);
    } catch {
      // 알림 실패해도 등록은 정상 처리
    }

    // 번호판·얼굴 blur (비동기 백그라운드 — 응답 블로킹 없음)
    if (item.photos && typeof item.photos === 'object') {
      setImmediate(async () => {
        try {
          const photos = item.photos as Record<string, string[]>;
          const blurred: Record<string, string[]> = {};
          for (const [cat, urls] of Object.entries(photos)) {
            blurred[cat] = await this.blurService.blurPhotoUrls(urls ?? []);
          }
          await this.service.update(item.id, { photos: blurred });
        } catch { /* blur 실패해도 원본 유지 */ }
      });
    }

    return item;
  }

  // 방향 보정 로직 배포 이전에 이미 올라간 사진들을 일괄 재처리 (일회성 관리자용)
  @Post('reprocess-all-photos')
  @UseGuards(InternalKeyGuard)
  async reprocessAllPhotos() {
    const items: any[] = await this.service.findAll();
    const targets = items.filter((i) => i.photos && typeof i.photos === 'object');

    // 매물 수가 많으면 오래 걸릴 수 있어 백그라운드로 돌리고 즉시 응답
    setImmediate(async () => {
      for (const item of targets) {
        try {
          const photos = item.photos as Record<string, string[]>;
          const reprocessed: Record<string, string[]> = {};
          for (const [cat, urls] of Object.entries(photos)) {
            reprocessed[cat] = Array.isArray(urls) && urls.length
              ? await this.blurService.blurPhotoUrls(urls)
              : urls;
          }
          await this.service.update(item.id, { photos: reprocessed });
        } catch {
          // 개별 매물 재처리 실패해도 나머지는 계속 진행
        }
      }
    });

    return {
      ok: true,
      message: `${targets.length}개 매물의 사진 재처리를 백그라운드에서 시작했습니다.`,
      totalItems: targets.length,
    };
  }

  @Patch()
  async update(@Query('id') id: string, @Body() body: Partial<StoreItem>) {
    if (!id) throw new NotFoundException('id 파라미터가 필요합니다.');
    return this.service.update(Number(id), body);
  }

  @Delete()
  async remove(@Query('id') id: string) {
    if (!id) throw new NotFoundException('id 파라미터가 필요합니다.');
    await this.service.remove(Number(id));
    return { ok: true };
  }

  // 관리자가 낙찰 딜러의 차대금 입금을 육안으로 확인 — winner_selected → in_transit 전환 게이트
  @Patch(':id/confirm-deposit')
  @UseGuards(InternalKeyGuard)
  confirmDeposit(@Param('id') id: string) {
    return this.service.confirmDeposit(Number(id));
  }

  // 거래완료 시 명의이전된 등록증 사진 업로드 — 저장과 동시에 saleStage를 completed로 전환
  @Post(':id/transferred-registration')
  @UseGuards(InternalKeyGuard)
  @UseInterceptors(FileInterceptor('photo', { storage: memoryStorage() }))
  async uploadTransferredRegistration(@Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('사진을 첨부해주세요.');
    const key = `transferred-registrations/store-items/${id}/${Date.now()}${extname(file.originalname)}`;
    const url = await this.s3Service.uploadFile(file, key);
    return this.service.update(Number(id), { transferredRegistrationUrl: url, saleStage: 'completed' } as any);
  }

  // ── 조회수/좋아요 (공개 엔드포인트, Next.js /api 대체) ───────────
  @Get(':id/stats')
  getStats(@Param('id') id: string) {
    return this.service.getStats(Number(id));
  }

  @Post(':id/stats')
  updateStats(@Param('id') id: string, @Body('action') action: string) {
    return this.service.updateStats(Number(id), action);
  }
}
