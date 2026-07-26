import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import archiver from 'archiver';
import type { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from 'src/bookings/entities/booking.entity';
import { Inspection } from './entities/inspection.entity';
import { User } from 'src/users/entities/user.entity';
import { SolapiService } from 'src/solapi/solapi.service';
import { DriversService } from 'src/drivers/drivers.service';
import { ComplianceService } from 'src/compliance/compliance.service';
import { ScheduledNotificationsService } from 'src/scheduled-notifications/scheduled-notifications.service';
import { TranslateService } from 'src/translate/translate.service';

const PARTNER_COMPLETION_DELAY_MS = 60 * 60 * 1000; // 1시간

@Injectable()
export class InspectionService {
  private s3Client: S3Client;

  constructor(
    private configService: ConfigService,
    private readonly solapiService: SolapiService,
    private readonly driversService: DriversService,
    private readonly complianceService: ComplianceService,
    private readonly scheduledNotificationsService: ScheduledNotificationsService,
    private readonly translateService: TranslateService,
    @InjectRepository(Inspection)
    private readonly inspectionRepository: Repository<Inspection>,
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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
   * 진단 사진은 리포트/앱 그리드에서 항상 작게 표시되는데, 원본(수 MB짜리 카메라 사진)을
   * 그대로 올리면 리포트 스크롤·앱 렌더링이 느려진다. 가로/세로 최대 1600px, JPEG 78%로
   * 재인코딩해서 화질은 웹/앱 표시에 충분하면서 용량은 크게 줄인다. 실패하면 원본 그대로 사용.
   */
  private async compressImage(buffer: Buffer, mimetype?: string): Promise<{ buffer: Buffer; contentType: string }> {
    if (mimetype && !mimetype.startsWith('image/')) {
      return { buffer, contentType: mimetype };
    }
    try {
      const out = await sharp(buffer)
        .rotate() // EXIF 방향 정보 반영 후 굽기
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 78 })
        .toBuffer();
      return { buffer: out, contentType: 'image/jpeg' };
    } catch (e) {
      console.error('[이미지 압축 실패, 원본 사용]', e instanceof Error ? e.message : e);
      return { buffer, contentType: mimetype || 'image/jpeg' };
    }
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
    const safeFileName = file.originalname.replace(/\s/g, '_').replace(/\.\w+$/, '.jpg');
    const key = `${safeCarNumber}/${category}/${timestamp}_${safeFileName}`;

    const start = Date.now();
    console.log(`[S3 Upload] 시작 | key=${key} | size=${file.size}bytes | mime=${file.mimetype}`);

    try {
      // 보험이력(vin)은 보험개발원 사이트 등에서 캡처한 텍스트 위주 이미지라, 리사이즈·재압축을
      // 거치면 글자가 뭉개져 못 읽는 문제가 있었다 — 이 카테고리만 압축 없이 원본 그대로 올린다.
      const { buffer, contentType } = category === 'vin'
        ? { buffer: file.buffer, contentType: file.mimetype || 'image/jpeg' }
        : await this.compressImage(file.buffer, file.mimetype);
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );
      const elapsed = Date.now() - start;
      console.log(`[S3 Upload] 완료 | key=${key} | 원본=${file.size}bytes → 압축=${buffer.length}bytes | 소요=${elapsed}ms`);
      // 실제 접근 가능한 S3 URL 반환
      return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    } catch (error) {
      const elapsed = Date.now() - start;
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[S3 Upload] 실패 | key=${key} | 소요=${elapsed}ms | error=${msg}`);
      console.error('[S3 Upload] 상세:', error);
      throw new BadRequestException(`S3 파일 업로드에 실패했습니다. (${msg})`);
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
          const safeFileName = file.originalname.replace(/\s/g, '_').replace(/\.\w+$/, '.jpg');
          const key = `${safeCarNumber}/${category}/${timestamp}_${safeFileName}`;
          const start = Date.now();
          console.log(`[S3 Batch] 업로드 시작 | key=${key} | size=${file.size}bytes`);

          try {
            const { buffer, contentType } = await this.compressImage(file.buffer, file.mimetype);
            await this.s3Client.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: buffer,
                ContentType: contentType,
              }),
            );
            const elapsed = Date.now() - start;
            console.log(`[S3 Batch] 완료 | key=${key} | 원본=${file.size}bytes → 압축=${buffer.length}bytes | 소요=${elapsed}ms`);
            return {
              url: `https://${bucket}.s3.${region}.amazonaws.com/${key}`,
              originalname: file.originalname,
            };
          } catch (error) {
            const elapsed = Date.now() - start;
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`[S3 Batch] 실패 | key=${key} | 소요=${elapsed}ms | error=${msg}`);
            return {
              url: null,
              originalname: file.originalname,
              error: msg,
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
    // carHash는 최초 1회만 생성하고 이후엔 절대 바꾸지 않는다 — 예전엔 carNumber로만 해시를 만들어서
    // (1) 접수 시점엔 "미정"이라 알림톡·리포트 링크가 sha256("미정") 기준으로 나갔다가, 평가사가
    //     +2시간 안에 실제 차량번호로 수정·재제출하면 해시가 통째로 바뀌어 이미 보낸 링크가
    //     "레포트를 찾을 수 없습니다"로 깨져버렸고 (2) "미정"인 건이 여러 개면 전부 같은 해시라
    //     서로 다른 고객의 리포트가 충돌할 수도 있었음. bookingId+시각 기반으로 한 번만 생성해서 고정.
    if (!inspection.carHash) {
      inspection.carHash = createHash('sha256')
        .update(`${bId}-${Date.now()}-${Math.random()}`)
        .digest('hex')
        .slice(0, 16);
    }
    inspection.carModel = data.carModel || '알수없음';
    inspection.mileage = Number(data.mileage) || 0;
    inspection.color = data.color || '';
    inspection.repairCost = Number(data.repairCost) || 0;

    // [이미지]
    inspection.dashboardImage = data.dashboardImage;
    inspection.regImage = data.regImage;
    inspection.vinImage = data.vinImage;
    inspection.exportVideoUrls = Array.isArray(data.exportVideoUrls) ? data.exportVideoUrls : null;
    inspection.engineNoiseVideoUrl = data.engineNoiseVideoUrl || null;
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
    inspection.checklistPhotos = {
      warning: data.checklistPhotos?.warning || [],
      options: data.checklistPhotos?.options || [],
      leak: data.checklistPhotos?.leak || [],
      drive: data.checklistPhotos?.drive || [],
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
    // 평가사가 +2시간 자기수정 창 안에서 다시 제출하면 이 함수가 또 호출되는데,
    // 그때는 이미 firstCompletedAt이 있으므로 "최초 완료"가 아니다 — 알림은 최초 1회만.
    const isFirstCompletion = !inspection.firstCompletedAt;
    inspection.completedAt = new Date();
    if (isFirstCompletion) inspection.firstCompletedAt = inspection.completedAt;

    try {
      const savedResult = await this.inspectionRepository.save(inspection);

      // 예약 테이블의 상태를 'COMPLETED'로 변경
      const booking = await this.bookingRepository.findOne({ where: { id: bId } });
      await this.bookingRepository.update(bId, { status: 'COMPLETED' });

      if (isFirstCompletion) {
        // 진단 완료 알림톡 발송 (서버 환경 안전한 KST 포맷) — 최초 제출에만, 재제출(수정)엔 재발송 안 함
        const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // UTC+9
        const pad = (n: number) => String(n).padStart(2, '0');
        const completedAt = `${now.getUTCFullYear()}.${pad(now.getUTCMonth() + 1)}.${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
        console.log(`[알림톡] 발송 시작 - 차량: ${inspection.carNumber}, 완료시간: ${completedAt}`);
        const completionVariables = {
          '#{차량번호}': inspection.carNumber,
          '#{완료시간}': completedAt,
          '#{예약번호}': savedResult.carHash,
        };
        await this.solapiService.sendCompletionAlimTalk(completionVariables, booking?.source);

        // 구매동행(카비어 검차 서비스, /inspection에서 결제한 건)은 중간에 발주사/딜러가
        // 없이 소비자 본인이 직접 신청한 거라, 완료되면 신청자 본인에게도 곧바로 리포트
        // 완료 알림톡을 보낸다(기존 완료 템플릿 재사용 — 문구가 중립적이라 그대로 사용 가능).
        if (booking?.source === 'CARVIOR_INSPECTION') {
          const customerPhone = booking.customerContact || booking.contact;
          if (customerPhone) {
            this.solapiService
              .sendCompletionAlimTalkTo(customerPhone, completionVariables)
              .catch((e) => console.error('[알림톡] 구매동행 고객 발송 실패', e));
          } else {
            console.log(`🔕 [구매동행 고객 알림톡 생략] ${inspection.carNumber} — 연락처 없음`);
          }
        }

        // 협업 파트너사 대표님은 1시간 뒤 발송 — 매니저/평가사 검토 시간 확보 목적.
        // setTimeout이 아니라 DB 예약이라 그 사이 서버가 재배포돼도 유실되지 않는다.
        // 수신번호는 "관리자 계정 관리"에 등록된 그 발주사 관리자 계정의 연락처를 그대로 씀 —
        // 대시보드에서 번호를 바꾸면(업무폰 변경 등) 코드 수정 없이 알림도 그쪽으로 바로 감.
        const partnerAdmin = booking?.source
          ? await this.userRepository.findOne({ where: { role: 'admin', company: booking.source } })
          : null;
        const partnerPhone = partnerAdmin?.phone;
        if (partnerPhone) {
          this.scheduledNotificationsService
            .schedule({
              type: 'completion_partner',
              recipientPhone: partnerPhone,
              variables: completionVariables,
              delayMs: PARTNER_COMPLETION_DELAY_MS,
            })
            .catch((e) => console.error('[예약알림] 등록 실패', e));
        }
      } else {
        console.log(`[알림톡] 재제출(수정) 감지 - bId=${bId}, 알림 재발송 안 함`);
      }

      console.log(`[Success] ID ${bId} 모든 진단 데이터 저장 완료`);

      // 자동차관리법 시행규칙 제144조의3 — 등록증 사진으로 3년 보관 기록 스냅샷 생성.
      // OCR·저장 실패해도 진단 저장 자체는 이미 끝났으므로 절대 블로킹하지 않음
      if (inspection.regImage) {
        this.complianceService
          .captureFromRegistrationImage({
            imageUrl: inspection.regImage,
            bookingId: bId,
            carHash: savedResult.carHash,
            plateNumberFallback: inspection.carNumber,
          })
          .catch(() => { /* 로그는 서비스 내부에서 이미 남김 */ });
      }

      return { success: true, id: savedResult.id };
    } catch (error) {
      console.error('DB Save Error:', error);
      throw new BadRequestException('진단 데이터 저장 중 오류가 발생했습니다.');
    }
  }

  /**
   * 2-b. 관리자 → 진단사 재촬영/수정 요청 (SMS)
   * 진단사 본인 수정마감(2h) 이후에도 관리자가 사진/데이터 이상을 발견하면
   * 진단사에게 재촬영·수정을 요청할 수 있도록.
   */
  // recipientDriverId를 주면 원 담당 진단사 대신 그 진단사(예: 진단매니저 업무폰 계정)에게 보냄 —
  // 진단매니저가 자기 폰으로 수정하려면 원 평가사가 아닌 자기 계정으로 링크를 받아야 하기 때문
  async requestUpdateFromEvaluator(bookingId: number, message?: string, category?: string, recipientDriverId?: number) {
    const booking = await this.bookingRepository.findOne({ where: { id: bookingId } });
    if (!booking) throw new BadRequestException('예약을 찾을 수 없습니다.');

    const driver = recipientDriverId
      ? await this.driversService.findById(recipientDriverId)
      : booking.assignedDriverId
        ? await this.driversService.findByAccountId(booking.assignedDriverId)
        : null;
    if (!driver) throw new BadRequestException('보낼 대상(진단사/매니저)을 찾을 수 없습니다.');
    if (!driver?.phone) throw new BadRequestException('연락처를 찾을 수 없습니다.');

    // 앱 딥링크(chavatarapp://...)는 길어서 SMS 90byte 제한을 넘겨 접수 자체가 거부됨.
    // 알림톡 템플릿 승인 전까지는 링크 없이 짧은 안내문만 SMS로 보내고,
    // 진단사는 앱에서 직접 "진단 내역 보기 → 수정하기"로 들어가서 확인
    const title = category ? `${booking.carNumber} [${category}] 재촬영요청` : `${booking.carNumber} 재촬영요청`;
    let detail = message?.trim() || '앱에서 확인 후 수정 부탁드립니다.';
    let text = `[카비어] ${title} ${detail}`;
    // 90byte(EUC-KR 기준) 안전마진 — 넘으면 상세 문구부터 한 글자씩 잘라냄
    while (Buffer.byteLength(text, 'utf-8') > 88 && detail.length > 1) {
      detail = detail.slice(0, -1);
      text = `[카비어] ${title} ${detail}…`;
    }

    await this.solapiService.sendSms(driver.phone, text);
    return { ok: true, sentTo: driver.phone, driverName: driver.name };
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

  /**
   * 6. 관리자(진단매니저) 웹 손상부위 수정 — 앱 마킹 결과를 대시보드에서 그대로 덮어씀
   */
  async updateDamages(bookingId: number, checkedDamages: string[][]) {
    const inspection = await this.inspectionRepository.findOne({ where: { bookingId } });
    if (!inspection) throw new BadRequestException('진단 내역을 찾을 수 없습니다.');
    inspection.checkedDamages = checkedDamages;
    return this.inspectionRepository.save(inspection);
  }

  // 관리자/발주사가 완료된 리포트의 오탈자·누락값을 직접 고칠 때 사용 — 스마트옥션 매물
  // 등록/수정(사진·가격 등)과는 별개 기능이라 슈퍼 관리자 제한 없이 열어둠. carHash는
  // 건드리지 않으므로(최초 생성 후 고정) 이미 발송된 리포트 링크는 계속 유효하다.
  async updateReportFields(bookingId: number, data: {
    carNumber?: string;
    carModel?: string;
    mileage?: number;
    color?: string;
    repairCost?: number;
    memo?: string;
    inspectionDetails?: { warningDesc?: string; leakDesc?: string; optionsDesc?: string; driveDesc?: string };
    photos?: Record<string, string[]>;
    dashboardImage?: string;
    regImage?: string;
    vinImage?: string;
    exportVideoUrls?: string[];
    engineNoiseVideoUrl?: string;
    checklistPhotos?: { warning?: string[]; options?: string[]; leak?: string[]; drive?: string[] };
  }) {
    const inspection = await this.inspectionRepository.findOne({ where: { bookingId } });
    if (!inspection) throw new BadRequestException('진단 내역을 찾을 수 없습니다.');

    // 프론트 버튼 비활성화만으론 URL 직접 접근·API 직접 호출을 못 막으므로 서버에서도 검증
    const REPORT_EDIT_WINDOW_MS = 4 * 60 * 60 * 1000;
    if (inspection.firstCompletedAt && Date.now() - new Date(inspection.firstCompletedAt).getTime() > REPORT_EDIT_WINDOW_MS) {
      throw new BadRequestException('수정 가능 시간(진단 완료 후 4시간)이 지났습니다.');
    }

    if (data.carNumber !== undefined) inspection.carNumber = data.carNumber;
    if (data.carModel !== undefined) inspection.carModel = data.carModel;
    if (data.mileage !== undefined) inspection.mileage = data.mileage;
    if (data.color !== undefined) inspection.color = data.color;
    if (data.repairCost !== undefined) inspection.repairCost = data.repairCost;
    if (data.memo !== undefined) inspection.memo = data.memo;
    if (data.inspectionDetails) {
      inspection.inspectionDetails = { ...inspection.inspectionDetails, ...data.inspectionDetails };
    }
    if (data.photos) {
      inspection.photos = {
        exterior: data.photos.exterior || [],
        wheel: data.photos.wheel || [],
        undercarriage: data.photos.undercarriage || [],
        interior: data.photos.interior || [],
        engine: data.photos.engine || [],
        damage: data.photos.damage || [],
        extra: data.photos.extra || [],
        extraMemo: data.photos.extraMemo || [],
      };
    }
    if (data.dashboardImage !== undefined) inspection.dashboardImage = data.dashboardImage;
    if (data.regImage !== undefined) inspection.regImage = data.regImage;
    if (data.vinImage !== undefined) inspection.vinImage = data.vinImage;
    if (data.exportVideoUrls !== undefined) inspection.exportVideoUrls = data.exportVideoUrls;
    if (data.engineNoiseVideoUrl !== undefined) inspection.engineNoiseVideoUrl = data.engineNoiseVideoUrl;
    if (data.checklistPhotos) {
      inspection.checklistPhotos = {
        warning: data.checklistPhotos.warning || [],
        options: data.checklistPhotos.options || [],
        leak: data.checklistPhotos.leak || [],
        drive: data.checklistPhotos.drive || [],
      };
    }

    const saved = await this.inspectionRepository.save(inspection);

    // 차량번호를 고쳤으면 예약 테이블(대시보드 목록에 보이는 차량번호)도 같이 맞춰준다
    if (data.carNumber !== undefined) {
      await this.bookingRepository.update(bookingId, { carNumber: data.carNumber });
    }

    return saved;
  }

  async getInspectionByBookingId(bookingId: number) {
    const inspection = await this.inspectionRepository.findOne({ where: { bookingId } });
    if (!inspection) throw new BadRequestException('진단 내역을 찾을 수 없습니다.');
    return this.withDealerName(inspection);
  }

  async getInspectionByCarHash(carHash: string) {
    const inspection = await this.inspectionRepository.findOne({ where: { carHash } });
    if (!inspection) throw new BadRequestException('진단 내역을 찾을 수 없습니다.');
    return this.withDealerName(inspection);
  }

  // 리포트에 딜러(신청자)/평가한 진단사 이름을 표시하기 위해 Inspection에는 없는
  // Booking.dealerName·assignedDriverName을 붙여서 반환
  private async withDealerName(inspection: Inspection) {
    const booking = await this.bookingRepository.findOne({ where: { id: inspection.bookingId } });
    const isOk = (v?: string | null) => !v || v === '이상 없음';
    return {
      ...inspection,
      dealerName: booking?.dealerName ?? null,
      driverName: booking?.assignedDriverName ?? null,
      assignedDriverId: booking?.assignedDriverId ?? null,
      carOwner: booking?.carOwner ?? null,
      // 구매동행(카비어 검차 서비스, /inspection에서 결제한 건) 리포트에만 리뷰 작성
      // 섹션을 노출한다 — 딜러가 의뢰한 B2B 리포트는 리뷰 대상이 아니라서 구분해서 내려줌.
      isConsumerBooking: booking?.source === 'CARVIOR_INSPECTION',
      // 번역 전 원문(한국어) 기준 이상유무 — applyLanguage()가 텍스트를 번역해도
      // 프런트에서 "이상 없음" 문자열 비교로 정상/이상 배지를 판단하다 깨지는 일이 없게 함
      evaluationOk: {
        leak: isOk(inspection.inspectionDetails?.leakDesc),
        drive: isOk(inspection.inspectionDetails?.driveDesc),
        options: isOk(inspection.inspectionDetails?.optionsDesc),
        warning: isOk(inspection.inspectionDetails?.warningDesc),
      },
    };
  }

  // 딜러 의뢰 리포트(수출용 차량 등)에서만 다국어 지원 — 번역 대상은 평가사가 직접
  // 입력하는 자유 텍스트뿐(부위명/라벨 등 고정 텍스트는 프런트에서 자체 번역해서 표시).
  private readonly TRANSLATABLE_FIELDS = ['memo', 'warningDesc', 'leakDesc', 'optionsDesc', 'driveDesc'] as const;
  private readonly SUPPORTED_LANGS = ['en', 'ru', 'ar'];

  // Azure Translator는 유료 전환 걱정 없는 무료 F0 티어(월 200만자, 기간 제한 없음)라도
  // 아낄수록 좋으니, 이미 번역해둔 리포트는 재호출 없이 캐시(translations 컬럼)를 그대로 쓴다.
  private async ensureTranslations(inspection: Inspection): Promise<Record<string, Record<string, string>> | null> {
    if (inspection.translations) return inspection.translations;

    const details = inspection.inspectionDetails ?? ({} as Record<string, string>);
    const texts = this.TRANSLATABLE_FIELDS.map((f) => (f === 'memo' ? inspection.memo : (details as any)[f]) || '');
    if (texts.every((t) => !t)) return null; // 번역할 내용 자체가 없으면 API 호출을 아예 생략

    try {
      const byLang = await this.translateService.translateBatch(texts, this.SUPPORTED_LANGS);
      const translations: Record<string, Record<string, string>> = {};
      for (const lang of this.SUPPORTED_LANGS) {
        translations[lang] = {};
        this.TRANSLATABLE_FIELDS.forEach((f, i) => { translations[lang][f] = byLang[lang][i]; });
      }
      await this.inspectionRepository.update(inspection.id, { translations });
      return translations;
    } catch (e) {
      console.error('❌ [리포트 번역 실패]', (e as Error).message);
      return null; // 번역 실패해도 리포트 자체는 한국어로 정상 노출(블로킹하지 않음)
    }
  }

  // 리포트 조회 시 ?lang= 쿼리로 넘어온 언어를 적용 — 구매동행(소비자) 리포트는 항상
  // 한국어만 노출(백엔드에서도 한 번 더 방어), 지원하지 않는 언어 코드는 무시하고 원문 반환.
  async applyLanguage<T extends Inspection & { isConsumerBooking?: boolean; inspectionDetails?: any }>(
    inspection: T, lang?: string,
  ): Promise<T> {
    if (!lang || lang === 'ko' || inspection.isConsumerBooking || !this.SUPPORTED_LANGS.includes(lang)) {
      return inspection;
    }

    const translations = await this.ensureTranslations(inspection);
    const t = translations?.[lang];
    if (!t) return inspection;

    return {
      ...inspection,
      memo: t.memo || inspection.memo,
      inspectionDetails: {
        ...inspection.inspectionDetails,
        warningDesc: t.warningDesc || inspection.inspectionDetails?.warningDesc,
        leakDesc: t.leakDesc || inspection.inspectionDetails?.leakDesc,
        optionsDesc: t.optionsDesc || inspection.inspectionDetails?.optionsDesc,
        driveDesc: t.driveDesc || inspection.inspectionDetails?.driveDesc,
      },
    };
  }

  // 리포트 사진 전체를 1.jpg, 2.jpg ... 순번으로 이름 붙여 zip으로 압축해 스트리밍.
  // 등록증·차대번호(개인정보 사진)는 리포트 화면에도 안 보여주는 것과 동일하게 제외.
  async streamPhotosZip(carHash: string, res: Response) {
    const inspection = await this.inspectionRepository.findOne({ where: { carHash } });
    if (!inspection) throw new BadRequestException('진단 내역을 찾을 수 없습니다.');

    const categoryOrder = ['exterior', 'wheel', 'undercarriage', 'interior', 'engine', 'damage', 'extra', 'extraMemo'];
    const urls: string[] = [];
    for (const cat of categoryOrder) {
      const arr = (inspection.photos as any)?.[cat];
      if (Array.isArray(arr)) urls.push(...arr);
    }
    if (inspection.dashboardImage) urls.push(inspection.dashboardImage);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(inspection.carNumber || 'report')}_photos.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    let seq = 1;
    for (const url of urls.slice(0, 100)) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const buffer = Buffer.from(await r.arrayBuffer());
        const ext = url.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
        archive.append(buffer, { name: `${seq}.${ext}` });
        seq++;
      } catch {
        // 사진 하나가 실패해도 나머지는 계속 담는다
      }
    }
    await archive.finalize();
  }
}