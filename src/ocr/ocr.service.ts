import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const FUEL_MAP: Record<string, string> = {
  '휘발유': '가솔린', '가솔린': '가솔린',
  '경유': '디젤', '디젤': '디젤',
  '하이브리드': '하이브리드',
  'LPG': 'LPG', '액화석유': 'LPG',
  '전기': '전기',
};

// ①②...⑳ 접두사 제거
const stripPrefix = (s: string) => s.replace(/[①-⑳⑴-⒇]/g, '').trim();

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private readonly clovaUrl: string;
  private readonly clovaSecret: string;

  constructor(config: ConfigService) {
    this.clovaUrl    = config.get('CLOVA_OCR_API_URL') ?? '';
    this.clovaSecret = config.get('CLOVA_OCR_SECRET')  ?? '';
  }

  async parseRegistration(file: Express.Multer.File) {
    const base64 = file.buffer.toString('base64');
    const format = (file.mimetype || 'image/jpeg').split('/')[1] || 'jpg';
    return this.callClova(base64, format, 'registration');
  }

  async parseFromUrl(imageUrl: string, mode: 'registration' | 'insurance' | 'dashboard') {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return { error: '이미지 다운로드 실패' };
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
    const format = contentType.split('/')[1]?.split(';')[0] || 'jpg';
    const base64 = buffer.toString('base64');
    return this.callClova(base64, format, mode);
  }

  private async callClova(base64: string, format: string, mode: 'registration' | 'insurance' | 'dashboard') {
    const res = await fetch(this.clovaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OCR-SECRET': this.clovaSecret,
      },
      body: JSON.stringify({
        version: 'V2',
        requestId: crypto.randomUUID(),
        timestamp: Date.now(),
        lang: 'ko',
        images: [{ format, name: mode, data: base64 }],
        enableTableDetect: false,
      }),
    });

    if (!res.ok) {
      this.logger.error(`[OCR] Clova 오류: ${res.status}`);
      return { error: '인식 실패' };
    }

    const json = await res.json();
    const img  = json.images?.[0];
    if (img?.inferResult !== 'SUCCESS') return { error: 'OCR 실패' };

    const texts: string[] = (img.fields ?? []).map((f: any) => f.inferText as string);
    if (mode === 'insurance') return this.extractInsurance(texts);
    if (mode === 'dashboard') return this.extractDashboard(texts);
    return { ...this.extract(texts), _rawTexts: texts };
  }

  /**
   * 인접 토큰을 이어붙여 키워드 매칭.
   * - ①②... 접두사 자동 제거
   * - "자동차등록번호", 번호판 패턴 → 건너뜀 (차명 뒤에 오는 경우)
   */
  private findAfter(texts: string[], keywords: string[]): string | null {
    for (let i = 0; i < texts.length; i++) {
      for (let labelLen = 1; labelLen <= 5; labelLen++) {
        if (i + labelLen > texts.length) break;
        const label = texts.slice(i, i + labelLen)
          .map(stripPrefix)
          .join('')
          .replace(/\s/g, '');

        for (const kw of keywords) {
          const k = kw.replace(/\s/g, '');
          if (!label.startsWith(k)) continue;

          // 라벨 자체에 값이 붙어있는 경우 ("차명:투싼")
          const colonIdx = label.indexOf(':');
          const rest = colonIdx >= 0 ? label.slice(colonIdx + 1) : label.slice(k.length);
          const restClean = rest.replace(/^\(.*?\)/, '').trim();
          // rest가 다른 필드 라벨이면 무시
          const isLabelFragment = /^(자동차|성명|차명|차대번호|배기량|연료|연식|승차|색상|주소|최초|형식|제작|원동기|주행거리|모델연도|제원)/.test(restClean);
          if (restClean && !/^[,./\s-]+$/.test(restClean) && !isLabelFragment) return restClean;

          // 다음 토큰에서 값 찾기
          const nextStart = i + labelLen;
          for (let j = nextStart; j <= Math.min(nextStart + 7, texts.length - 1); j++) {
            const next = stripPrefix(texts[j]).trim();
            if (!next || /^[,./\s-]+$/.test(next)) continue;
            // 자동차등록번호 라벨 또는 번호판 패턴 → 건너뜀
            if (/^자동차등록번호/.test(next)) continue;
            if (/^\d{2,3}[가-힣]\d{4}$/.test(next)) continue;
            // 다른 필드 라벨이면 중단
            if (/^(성명|차명|차대번호|배기량|연료|연식|승차|색상|주소|최초|형식|제작|원동기|주행거리|모델연도|제원)/.test(next)) break;
            return next.replace(/,$/, '').trim();
          }
        }
      }
    }
    return null;
  }

  private extract(texts: string[]) {
    const blob = texts.map(stripPrefix).join(' ');

    // ── 차량번호 ─────────────────────────────────────────────────────
    const plateCtx = /자동차등록번호\s*([가-힣]{0,2}\s*\d{2,3}\s*[가-힣]\s*\d{4})/
      .exec(blob)?.[1]?.replace(/\s/g, '') ?? null;
    const plateFallback = /(?<![가-힣])(\d{2,3}[가-힣]\d{4})/.exec(blob)?.[1] ?? null;
    const plate = plateCtx ?? plateFallback;

    // ── 차명: 번호판 바로 뒤, 다음 필드 라벨 앞 (자동차등록증 레이아웃) ──
    const carNameFromLayout = (() => {
      if (!plate) return null;
      const plateIdx = blob.indexOf(plate);
      if (plateIdx < 0) return null;
      const afterPl = blob.slice(plateIdx + plate.length).trim();
      // 다음 필드 구분자 앞까지만
      const stopMatch = /\s+(?:차\s*종|형식\s*및|용도|②|③|⑤)/.exec(afterPl);
      if (!stopMatch || stopMatch.index === 0) return null;
      return afterPl.slice(0, stopMatch.index).trim() || null;
    })();

    // ── 연식 ─────────────────────────────────────────────────────────
    // "연식/모델연도" 없으면 최초등록일·제작연월에서 추출
    const yearRaw = /(?:모델연도|연식)[\s\S]*?(\b(?:19|20)\d{2}\b)/.exec(blob)?.[1]
      ?? /최초등록일[^\d]*(\d{4})/.exec(blob)?.[1]
      ?? /제작연월[^\d]*(\d{4})/.exec(blob)?.[1]
      ?? null;

    // ── 차대번호 (VIN, 17자리) ────────────────────────────────────────
    const vin = /\b([A-HJ-NPR-Z0-9]{17})\b/.exec(blob)?.[0] ?? null;

    // ── 배기량 ────────────────────────────────────────────────────────
    // 1차: "배기량" 라벨 직후 / 2차: "1968 4 기통" 패턴 (테이블 레이아웃 혼재)
    const dispNum = /배기량[^0-9]*(\d{3,5})/.exec(blob)?.[1]
      ?? /(\d{3,5})\s+\d+\s*기통/.exec(blob)?.[1];

    // ── 승차정원: "N명" 패턴 (단위 "명"은 승차정원에만 사용) ───────────
    const seats = /\b([1-9])\s*명\b/.exec(blob)?.[1] ?? null;

    // ── 최초등록일 (토큰 분리로 인한 공백 허용) ─────────────────────────
    const dr = /(?:최초등록일|최초등록)[^0-9]*(\d{4})\s*[.년-]\s*(\d{1,2})\s*[.월-]\s*(\d{1,2})/.exec(blob);

    // ── 주행거리: 공백 포함·쉼표 포함 처리 ──────────────────────────────
    const mileageMatches = [
      ...[...blob.matchAll(/주행\s*거리[^0-9]*(\d{1,3},\d{3}|\d{4,6})/g)]
        .map(m => Number(m[1].replace(/,/g, ''))),
    ].filter(n => n > 0);
    const mileage = mileageMatches.length ? String(Math.max(...mileageMatches)) : null;

    // ── 연료 ─────────────────────────────────────────────────────────
    const fuelKey = Object.keys(FUEL_MAP).find(k => blob.includes(k));

    return {
      plateNumber:      plate,
      ownerName:        this.findAfter(texts, ['성명(명칭)', '성명', '성 명']),
      vin,
      carName:          carNameFromLayout ?? this.findAfter(texts, ['차명', '차 명']),
      // '제조사'는 배터리셀 제조사로 오인되므로 제외
      carBrand:         this.findAfter(texts, ['제작자', '제작회사']),
      modelYear:        yearRaw,
      displacement:     dispNum ? `${dispNum}cc` : null,
      fuelType:         fuelKey ? FUEL_MAP[fuelKey] : null,
      transmission:     null,
      seats,
      color:            this.findAfter(texts, ['색상', '차체색상', '색 상']),
      registrationDate: dr ? `${dr[1]}-${dr[2].padStart(2,'0')}-${dr[3].padStart(2,'0')}` : null,
      // 자동차등록증은 '사용본거지' 라벨 사용
      ownerAddress:     this.findAfter(texts, ['사용본거지', '차사용본거지', '주소', '주 소']),
      mileage,
    };
  }

  private extractInsurance(texts: string[]) {
    const blob = texts.map(stripPrefix).join(' ');
    const mileageMatches = [...blob.matchAll(/주행\s*거리[^0-9]*(\d{1,3},\d{3}|\d{4,6})/g)]
      .map(m => Number(m[1].replace(/,/g, '')));
    const kmMatches = [...blob.matchAll(/(\d{4,6})\s*(?:km|KM|Km)/g)].map(m => Number(m[1]));
    const all = [...mileageMatches, ...kmMatches];
    const mileage = all.length ? String(Math.max(...all)) : null;
    return { mileage, _rawTexts: texts };
  }

  private extractDashboard(texts: string[]) {
    const blob = texts.join(' ');

    // 1순위: "km" 단위가 바로 붙은 숫자만 사용 — 계기판은 보통 "162827km"처럼
    // 공백 없이 붙어서 나오는데, 숫자 바로 뒤에 문자가 오면 \b가 성립하지 않아
    // 기존 "연속 숫자" 매칭이 이런 값을 아예 못 잡고, 날짜("6/9/2026")의 "2026"처럼
    // 경계가 뚜렷한 엉뚱한 숫자가 최댓값으로 잘못 선택되던 문제
    const kmMatches = [
      ...[...blob.matchAll(/\b(\d{1,3},\d{3})\s*(?:km|KM|Km)/g)]
        .map(m => Number(m[1].replace(/,/g, ''))),
      ...[...blob.matchAll(/\b(\d{4,6})\s*(?:km|KM|Km)/g)]
        .map(m => Number(m[1])),
    ].filter(n => n >= 1000 && n <= 999999);

    if (kmMatches.length) {
      return { mileage: String(Math.max(...kmMatches)), _rawTexts: texts };
    }

    // 2순위(폴백): km 단위 표기를 못 찾았을 때만 일반 숫자 후보 중 최댓값 사용
    // (날짜·시간 등을 오인식할 수 있어 최후의 수단으로만)
    const withComma = [...blob.matchAll(/\b(\d{2,3}),(\d{3})\b/g)]
      .map(m => Number(m[1] + m[2]))
      .filter(n => n >= 10000 && n <= 999999);
    const continuous = [...blob.replace(/,/g, '').matchAll(/\b(\d{4,6})\b/g)]
      .map(m => Number(m[1]))
      .filter(n => n >= 1000 && n <= 999999);
    const all = [...withComma, ...continuous];
    const mileage = all.length ? String(Math.max(...all)) : null;
    return { mileage, _rawTexts: texts };
  }
}
