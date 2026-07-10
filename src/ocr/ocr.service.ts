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
    return this.extract(texts);
  }

  private findAfter(texts: string[], keywords: string[]): string | null {
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i].replace(/\s/g, '');
      for (const kw of keywords) {
        const k = kw.replace(/\s/g, '');
        if (!t.startsWith(k)) continue;
        const colonIdx = t.indexOf(':');
        const rest = colonIdx >= 0 ? t.slice(colonIdx + 1) : t.slice(k.length);
        if (rest.trim()) return rest.trim();
        for (let j = i + 1; j <= Math.min(i + 3, texts.length - 1); j++) {
          const next = texts[j].trim();
          if (!next) continue;
          if (/^(성명|차명|차대번호|배기량|연료|연식|승차|색상|주소|최초|형식|제작)/.test(next.replace(/\s/g, ''))) continue;
          return next;
        }
      }
    }
    return null;
  }

  private extract(texts: string[]) {
    const blob = texts.join(' ');

    const plate    = /([가-힣]{0,2}\s*\d{2,3}\s*[가-힣]\s*\d{4})/.exec(blob)?.[1]?.replace(/\s/g, '') ?? null;
    const year     = /(?:연식|형식)[^0-9]*(\d{4})/.exec(blob)?.[1] ?? null;
    const dispNum  = /배기량[^0-9]*(\d{3,5})/.exec(blob)?.[1];
    const seats    = /승차정원[^0-9]*(\d{1,2})/.exec(blob)?.[1] ?? null;
    const dr       = /최초등록일[^0-9]*(\d{4})[.년\-](\d{1,2})[.월\-](\d{1,2})/.exec(blob);

    const fuelRaw  = this.findAfter(texts, ['연료의종류', '연료의 종류', '연료종류', '연료']) ?? blob;
    const fuelKey  = Object.keys(FUEL_MAP).find(k => fuelRaw.includes(k));

    return {
      plateNumber:      plate,
      ownerName:        this.findAfter(texts, ['성명', '성 명']),
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
