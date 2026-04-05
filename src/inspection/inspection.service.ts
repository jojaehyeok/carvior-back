import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from 'src/bookings/entities/booking.entity';
import { Inspection } from './entities/inspection.entity';
import { SolapiService } from 'src/solapi/solapi.service';

@Injectable()
export class InspectionService {
  private s3Client: S3Client;

  constructor(
    private configService: ConfigService,
    private readonly solapiService: SolapiService,
    @InjectRepository(Inspection)
    private readonly inspectionRepository: Repository<Inspection>,
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
  ) {
    this.s3Client = new S3Client({
      region: this.configService.get('AWS_S3_REGION') || 'ap-northeast-2',
      credentials: {
        accessKeyId: this.configService.get('AWS_ACCESS_KEY') as string,
        secretAccessKey: this.configService.get('AWS_SECRET_KEY') as string,
      },
    });
  }

  /**
   * 1. S3 이미지 업로드 (실제 파일 전송)
   */
  async uploadToS3(
    file: Express.Multer.File,
    requestId: string,
    category: string,
    carNumber: string,
  ): Promise<string> {
    const bucket = this.configService.get('AWS_S3_BUCKET_NAME') as string;
    const region = this.configService.get('AWS_S3_REGION') || 'ap-northeast-2';
    const safeCarNumber = carNumber || requestId;
    const timestamp = Date.now();
    const safeFileName = file.originalname.replace(/\s/g, '_');
    const key = `${safeCarNumber}/${category}/${timestamp}_${safeFileName}`;

    const start = Date.now();
    console.log(`[S3 Upload] 시작 | key=${key} | size=${file.size}bytes | mime=${file.mimetype}`);

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );
      const elapsed = Date.now() - start;
      console.log(`[S3 Upload] 완료 | key=${key} | 소요=${elapsed}ms`);
      // 실제 접근 가능한 S3 URL 반환
      return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    } catch (error) {
      const elapsed = Date.now() - start;
      console.error(`[S3 Upload] 실패 | key=${key} | 소요=${elapsed}ms | error=${error?.message || error}`);
      console.error('[S3 Upload] 상세:', error);
      throw new BadRequestException(`S3 파일 업로드에 실패했습니다. (${error?.message})`);
    }
  }

  /**
   * 1-b. 배치 병렬 업로드 (여러 파일 동시 처리)
   */
  async uploadBatchToS3(
    files: Express.Multer.File[],
    requestId: string,
    category: string,
    carNumber: string,
  ): Promise<{ url: string | null; originalname: string; error?: string }[]> {
    const bucket = this.configService.get('AWS_S3_BUCKET_NAME') as string;
    const region = this.configService.get('AWS_S3_REGION') || 'ap-northeast-2';
    const safeCarNumber = carNumber || requestId;

    console.log(`[S3 Batch Upload] 시작 | category=${category} | 파일수=${files.length} | carNumber=${safeCarNumber}`);
    const batchStart = Date.now();

    const CONCURRENCY = 5; // 동시 업로드 수 (S3 연결 과부하 방지)
    const results: { url: string | null; originalname: string; error?: string }[] = [];

    // 파일을 CONCURRENCY 단위로 청크로 나눠서 병렬 처리
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const chunk = files.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (file) => {
          const timestamp = Date.now();
          const safeFileName = file.originalname.replace(/\s/g, '_');
          const key = `${safeCarNumber}/${category}/${timestamp}_${safeFileName}`;
          const start = Date.now();
          console.log(`[S3 Batch] 업로드 시작 | key=${key} | size=${file.size}bytes`);

          try {
            await this.s3Client.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: file.buffer,
                ContentType: file.mimetype,
              }),
            );
            const elapsed = Date.now() - start;
            console.log(`[S3 Batch] 완료 | key=${key} | 소요=${elapsed}ms`);
            return {
              url: `https://${bucket}.s3.${region}.amazonaws.com/${key}`,
              originalname: file.originalname,
            };
          } catch (error) {
            const elapsed = Date.now() - start;
            console.error(`[S3 Batch] 실패 | key=${key} | 소요=${elapsed}ms | error=${error?.message || error}`);
            return {
              url: null,
              originalname: file.originalname,
              error: error?.message || '업로드 실패',
            };
          }
        }),
      );
      results.push(...chunkResults);
    }

    const totalElapsed = Date.now() - batchStart;
    const successCount = results.filter((r) => r.url !== null).length;
    const failCount = results.length - successCount;
    console.log(`[S3 Batch Upload] 완료 | 총=${results.length} | 성공=${successCount} | 실패=${failCount} | 총소요=${totalElapsed}ms`);

    return results;
  }

  /**
   * 2. 최종 진단 결과 DB 저장 (엔티티 구조 완벽 매핑)
   */
  async saveInspectionResult(data: any) {
    const bId = parseInt(data.requestId);
    if (isNaN(bId)) throw new BadRequestException('유효하지 않은 requestId입니다.');

    // 📸 photos 수신 현황 로그
    const photoLog = Object.entries(data.photos || {}).map(([k, v]) => `${k}:${(v as any[])?.length ?? 0}`).join(' | ');
    console.log(`[Submit] bId=${bId} | photos → ${photoLog || '없음'}`);

    let inspection = await this.inspectionRepository.findOne({ where: { bookingId: bId } });

    if (!inspection) {
      inspection = new Inspection();
      inspection.bookingId = bId;
    }

    // [기본 정보]
    inspection.carNumber = data.carNumber;
    inspection.carModel = data.carModel || '알수없음';
    inspection.mileage = Number(data.mileage) || 0;
    inspection.color = data.color || '';
    inspection.repairCost = Number(data.repairCost) || 0;

    // [이미지]
    inspection.dashboardImage = data.dashboardImage;
    inspection.regImage = data.regImage;
    inspection.vinImage = data.vinImage;
    inspection.photos = {
      exterior: data.photos?.exterior || [],
      wheel: data.photos?.wheel || [],
      undercarriage: data.photos?.undercarriage || [],
      interior: data.photos?.interior || [],
      engine: data.photos?.engine || [],
      damage: data.photos?.damage || [],
      extra: data.photos?.extra || [],
      extraMemo: data.photos?.extraMemo || [],
    };

    // [상세 설명]
    inspection.inspectionDetails = {
      warningDesc: data.inspectionDetails?.warningDesc || '',
      leakDesc: data.inspectionDetails?.leakDesc || '',
      optionsDesc: data.inspectionDetails?.optionsDesc || '',
      driveDesc: data.inspectionDetails?.driveDesc || '',
    };

    // [🌟 carStatus: 차키, 타이어, 도색 상태 매핑]
    inspection.carStatus = {
      keys: {
        smart: Number(data.keys?.smart) || 0,
        general: Number(data.keys?.general) || 0,
        folding: Number(data.keys?.folding) || 0,
        special: Number(data.keys?.special) || 0,
        note: data.keys?.note || '',
      },
      paintNeeded: Number(data.paintNeeded) || 0,
      wheelScratch: Number(data.wheelScratch) || 0,
      tireTread: {
        front: Number(data.frontTire) || 0,
        back: Number(data.backTire) || 0,
      },
    };

    // [손상 체크 및 메모]
    inspection.checkedDamages = data.checkedDamages || [];
    inspection.mirrorMarkers = data.mirrorMarkers || null;
    inspection.memo = data.memo || '';
    inspection.completedAt = new Date();

    try {
      const savedResult = await this.inspectionRepository.save(inspection);
      
      // 예약 테이블의 상태를 'COMPLETED'로 변경
      const booking = await this.bookingRepository.findOne({ where: { id: bId } });
      await this.bookingRepository.update(bId, { status: 'COMPLETED' });

      // 진단 완료 알림톡 발송 (서버 환경 안전한 KST 포맷)
      const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // UTC+9
      const pad = (n: number) => String(n).padStart(2, '0');
      const completedAt = `${now.getUTCFullYear()}.${pad(now.getUTCMonth() + 1)}.${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
      console.log(`[알림톡] 발송 시작 - 차량: ${inspection.carNumber}, 완료시간: ${completedAt}`);
      await this.solapiService.sendCompletionAlimTalk({
        '#{차량번호}': inspection.carNumber,
        '#{완료시간}': completedAt,
        '#{예약번호}': String(bId),
      }, booking?.source);

      console.log(`[Success] ID ${bId} 모든 진단 데이터 저장 완료`);
      return { success: true, id: savedResult.id };
    } catch (error) {
      console.error('DB Save Error:', error);
      throw new BadRequestException('진단 데이터 저장 중 오류가 발생했습니다.');
    }
  }

  /**
   * 3. S3 이미지 삭제
   */
  async deleteFromS3(url: string) {
    if (!url || !url.includes('.com/')) return { success: false };
    const bucket = this.configService.get('AWS_S3_BUCKET_NAME');
    const key = decodeURIComponent(url.split('.com/')[1]);

    try {
      await this.s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  }

  /**
   * 4. 제출 후 개별 사진 URL 추가 (백그라운드 업로드 완료 시 호출)
   */
  async appendPhoto(bookingId: number, category: string, url: string) {
    const inspection = await this.inspectionRepository.findOne({ where: { bookingId } });
    if (!inspection) return { success: false };
    const photos = { ...(inspection.photos || {}) };
    photos[category] = [...(photos[category] || []), url];
    inspection.photos = photos;
    await this.inspectionRepository.save(inspection);
    return { success: true };
  }

  async getInspectionByBookingId(bookingId: number) {
    const inspection = await this.inspectionRepository.findOne({ where: { bookingId } });
    if (!inspection) throw new BadRequestException('진단 내역을 찾을 수 없습니다.');
    return inspection;
  }
}