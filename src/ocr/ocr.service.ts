import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const FUEL_MAP: Record<string, string> = {
  '휘발유': '가솔린', '가솔린': '가솔린',
  '경유': '디젤', '디젤': '디젤',
  '하이브리드': '하이브리드',
  'LPG': 'LPG', '액화석유': 'LPG',
  '전기': '전기',
};

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
    const base64  = file.buffer.toString('base64');
    const format  = (file.mimetype || 'image/jpeg').split('/')[1] || 'jpg';

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

    const json   = await res.json();
    const img    = json.images?.[0];
    if (img?.inferResult !== 'SUCCESS') return { error: 'OCR 실패' };

    const texts: string[] = (img.fields ?? []).map((f: any) => f.inferText as string);
    return { ...this.extract(texts), _rawTexts: texts };
  }

  private findAfter(texts: string[], keywords: string[]): string | null {
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i].replace(/\s/g, '');
      for (const kw of keywords) {
        const k = kw.replace(/\s/g, '');
        if (!t.startsWith(k)) continue;
        const colonIdx = t.indexOf(':');
        const rest = colonIdx >= 0 ? t.slice(colonIdx + 1) : t.slice(k.length);
        // 라벨 뒤에 "(명칭)" 같은 suffix만 남은 경우 무시
        const restClean = rest.replace(/^\(.*?\)/, '').trim();
        if (restClean && !/^[,.\-\/]+$/.test(restClean)) return restClean;
        for (let j = i + 1; j <= Math.min(i + 3, texts.length - 1); j++) {
          const next = texts[j].trim();
          if (!next) continue;
          if (/^[,.\-\/]+$/.test(next)) continue; // 구두점만인 토큰 skip
          if (/^(성명|차명|차대번호|배기량|연료|연식|승차|색상|주소|최초|형식|제작)/.test(next.replace(/\s/g, ''))) continue;
          return next.replace(/,$/, '').trim(); // 끝 콤마 제거
        }
      }
    }
    return null;
  }

  private extract(texts: string[]) {
    const blob = texts.join(' ');

    // 번호판: 앞에 한글 없는 신형(12가1234) 또는 지역명 포함 구형
    const REGIONS = '서울|경기|인천|부산|대구|광주|대전|울산|강원|충북|충남|전북|전남|경북|경남|제주|세종';
    const plateNew = /(?<![가-힣])(\d{2,3}[가-힣]\d{4})/.exec(blob)?.[1] ?? null;
    const plateOld = new RegExp(`((?:${REGIONS})\\d{2}[가-힣]\\d{4})`).exec(blob)?.[1]?.replace(/\s/g, '') ?? null;
    const plate = plateNew ?? plateOld;

    // 연식: "연식"만 매핑, 1980~2030 범위 검증
    const yearRaw = /연식[^0-9]*(\d{4})/.exec(blob)?.[1];
    const year = yearRaw && +yearRaw >= 1980 && +yearRaw <= 2030 ? yearRaw : null;
    const dispNum  = /배기량[^0-9]*(\d{3,5})/.exec(blob)?.[1];
    const seats    = /승차정원[^0-9]*(\d{1,2})/.exec(blob)?.[1] ?? null;
    const dr       = /최초등록일[^0-9]*(\d{4})[.년\-](\d{1,2})[.월\-](\d{1,2})/.exec(blob);

    const fuelRaw  = this.findAfter(texts, ['연료의종류', '연료의 종류', '연료종류', '연료']) ?? blob;
    const fuelKey  = Object.keys(FUEL_MAP).find(k => fuelRaw.includes(k));

    return {
      plateNumber:      plate,
      ownerName:        this.findAfter(texts, ['성명(명칭)', '성명', '성 명']),
      vin:              this.findAfter(texts, ['차대번호']),
      carName:          this.findAfter(texts, ['차명', '차 명']),
      carBrand:         this.findAfter(texts, ['제작자', '제조사', '제작회사']),
      modelYear:        year,
      displacement:     dispNum ? `${dispNum}cc` : null,
      fuelType:         fuelKey ? FUEL_MAP[fuelKey] : null,
      transmission:     null,
      seats,
      color:            this.findAfter(texts, ['색상', '차체색상', '색 상']),
      registrationDate: dr ? `${dr[1]}-${dr[2].padStart(2,'0')}-${dr[3].padStart(2,'0')}` : null,
      ownerAddress:     this.findAfter(texts, ['주소', '주 소']),
    };
  }
}
