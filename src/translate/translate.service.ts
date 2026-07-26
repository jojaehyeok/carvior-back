import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface AzureTranslateResult {
  translations: { text: string; to: string }[];
}

// 딜러 의뢰 리포트(수출용 차량 등)의 평가사 자유 텍스트를 다국어로 보여주기 위한 번역기.
// Azure Translator(F0 무료 티어, 월 200만자, 기간 제한 없음)를 그대로 호출만 한다 —
// 캐싱/호출 시점 판단은 inspection.service.ts 쪽 책임.
@Injectable()
export class TranslateService {
  constructor(private readonly configService: ConfigService) {}

  // texts 배열 하나를 targetLangs 전부로 한 번에 번역(호출 1회로 다국어 동시 처리 —
  // 무료 할당량을 언어 수만큼 낭비하지 않기 위함). 반환값: { en: [text1역, text2역...], ru: [...], ar: [...] }
  async translateBatch(texts: string[], targetLangs: string[]): Promise<Record<string, string[]>> {
    const key = this.configService.get<string>('AZURE_TRANSLATOR_KEY');
    const region = this.configService.get<string>('AZURE_TRANSLATOR_REGION');
    if (!key || !region) {
      throw new Error('AZURE_TRANSLATOR_KEY/REGION이 설정되지 않았습니다.');
    }

    const toParams = targetLangs.map((l) => `to=${encodeURIComponent(l)}`).join('&');
    const url = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=ko&${toParams}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Ocp-Apim-Subscription-Region': region,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(texts.map((t) => ({ Text: t || '' }))),
    });

    if (!res.ok) {
      throw new Error(`Azure Translator 오류: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as AzureTranslateResult[];
    const result: Record<string, string[]> = {};
    for (const lang of targetLangs) {
      result[lang] = data.map((item) => item.translations.find((t) => t.to === lang)?.text ?? '');
    }
    return result;
  }
}
