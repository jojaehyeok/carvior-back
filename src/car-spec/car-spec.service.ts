import { Injectable, Logger } from '@nestjs/common';

// EnCarAPI(encarapi.com) 프록시 — 앱에 API 키를 직접 넣으면 APK를 까서 유출될 수 있어서
// 반드시 백엔드를 거쳐서만 호출한다. 트라이얼(5일 €9.99) → Starter(월 €149) 자동전환 계약이라
// 실제로 계속 쓸지 확정되면 .env의 ENCAR_API_KEY만 갱신하면 됨(코드 변경 불필요).
@Injectable()
export class CarSpecService {
  private readonly logger = new Logger(CarSpecService.name);
  private readonly base = process.env.ENCAR_API_BASE || 'https://api.encarapi.com';
  private readonly apiKey = process.env.ENCAR_API_KEY || '';

  private async call(path: string, params: Record<string, string | undefined>) {
    if (!this.apiKey) {
      this.logger.warn('ENCAR_API_KEY 없음 — 제원/시세 조회 건너뜀');
      return null;
    }
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) qs.set(k, v);
    }
    const url = `${this.base}${path}?${qs.toString()}`;
    try {
      const res = await fetch(url, { headers: { 'x-api-key': this.apiKey } });
      if (!res.ok) {
        this.logger.error(`[EnCarAPI] ${path} 실패 ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (e: any) {
      this.logger.error(`[EnCarAPI] ${path} 오류: ${e.message}`);
      return null;
    }
  }

  // 진단 중 입력된 차량명(자유 텍스트, 예: "투싼")으로 제조사/모델/트림 후보를 찾는다.
  async search(query: string) {
    const data = await this.call('/api/model-search', { search: query, lang: 'ko' });
    const results = (data?.results ?? []) as any[];
    // 같은 모델의 트림(badgeGroup)별로 여러 줄이 오므로, 앱에서 고르기 쉽게 상위 8개만.
    return results.slice(0, 8).map((r) => ({
      manufacturer: r.manufacturer,
      model: r.modelGroup,
      badge: r.badgeGroup,
      count: r.count,
    }));
  }

  // 제조사/모델(+트림)로 실제 비교 매물(제원+실거래 시세)을 가져온다.
  async listings(manufacturer: string, model: string, badge?: string) {
    const data = await this.call('/api/catalog', {
      manufacturer,
      model,
      badge_group: badge,
      lang: 'ko',
      count: 'true',
    });
    const results = (data?.SearchResults ?? []) as any[];
    return results.slice(0, 20).map((r) => ({
      id: r.Id,
      model: r.Model,
      badge: r.Badge,
      year: r.FormYear,
      mileage: r.Mileage,
      fuel: r.FuelType,
      priceManwon: r.Price, // 만원 단위
      // Photo는 도메인 없는 상대경로("/carpicture09/pic4239/42391320_")로 옴 — 실제 이미지
      // CDN 호스트를 EnCarAPI 문서에서 확인 전까지는 원본 경로만 그대로 넘긴다(추측 금지).
      thumbnailPath: r.Photo ?? null,
    }));
  }
}
