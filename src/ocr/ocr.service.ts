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
        images: [{ format, name: 'reg', data: base64 }],
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
    return { ...this.extract(texts), _rawTexts: texts };
  }

  /**
   * 인접 토큰을 이어붙여 키워드 매칭.
   * - ①②... 접두사 자동 제거
   * - "④차" + "명" → "차명" 같은 분리된 라벨 처리
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
          if (restClean && !/^[,./\s-]+$/.test(restClean)) return restClean;

          // 다음 토큰에서 값 찾기
          const nextStart = i + labelLen;
          for (let j = nextStart; j <= Math.min(nextStart + 5, texts.length - 1); j++) {
            const next = stripPrefix(texts[j]).trim();
            if (!next || /^[,./\s-]+$/.test(next)) continue;
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
    // ①② 접두사 제거한 블롭
    const blob = texts.map(stripPrefix).join(' ');

    // ── 차량번호 ─────────────────────────────────────
    // "자동차등록번호" 직후 패턴 우선, fallback은 앞에 한글 없는 패턴
    const plateCtx = /자동차등록번호\s*([가-힣]{0,2}\s*\d{2,3}\s*[가-힣]\s*\d{4})/
      .exec(blob)?.[1]?.replace(/\s/g, '') ?? null;
    const plateFallback = /(?<![가-힣])(\d{2,3}[가-힣]\d{4})/.exec(blob)?.[1] ?? null;
    const plate = plateCtx ?? plateFallback;

    // ── 연식 ─────────────────────────────────────────
    // "모델연도" 또는 "연식" 다음 19xx/20xx 연도 (게으른 매칭으로 중간 코드 건너뜀)
    const yearRaw = /(?:모델연도|연식)[\s\S]*?(\b(?:19|20)\d{2}\b)/.exec(blob)?.[1] ?? null;

    // ── 차대번호 (VIN, 17자리) ────────────────────────
    const vin = /\b([A-HJ-NPR-Z0-9]{17})\b/.exec(blob)?.[0] ?? null;

    // ── 배기량 ────────────────────────────────────────
    const dispNum = /배기량[^0-9]*(\d{3,5})/.exec(blob)?.[1];

    // ── 승차정원 ──────────────────────────────────────
    const seats = /승차\s*(\d{1,2})\s*명/.exec(blob)?.[1]
               ?? /승차정원[^0-9]*(\d{1,2})/.exec(blob)?.[1]
               ?? null;

    // ── 최초등록일 ────────────────────────────────────
    const dr = /(?:최초등록일|최초등록)[^0-9]*(\d{4})[.년\-](\d{1,2})[.월\-](\d{1,2})/.exec(blob);

    // ── 주행거리 ──────────────────────────────────────
    const mileage = /주행거리[^0-9]*(\d{3,6})/.exec(blob)?.[1] ?? null;

    // ── 연료: 블롭 전체에서 FUEL_MAP 키 검색 ────────────
    const fuelKey = Object.keys(FUEL_MAP).find(k => blob.includes(k));

    return {
      plateNumber:      plate,
      ownerName:        this.findAfter(texts, ['성명(명칭)', '성명', '성 명']),
      vin,
      carName:          this.findAfter(texts, ['차명', '차 명']),
      carBrand:         this.findAfter(texts, ['제작자', '제조사', '제작회사']),
      modelYear:        yearRaw,
      displacement:     dispNum ? `${dispNum}cc` : null,
      fuelType:         fuelKey ? FUEL_MAP[fuelKey] : null,
      transmission:     null,
      seats,
      color:            this.findAfter(texts, ['색상', '차체색상', '색 상']),
      registrationDate: dr ? `${dr[1]}-${dr[2].padStart(2,'0')}-${dr[3].padStart(2,'0')}` : null,
      ownerAddress:     this.findAfter(texts, ['주소', '주 소']),
      mileage,
    };
  }
}
