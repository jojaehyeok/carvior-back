import { Injectable, Logger } from '@nestjs/common';

// EnCarAPI(encarapi.com) 프록시 — 앱에 API 키를 직접 넣으면 APK를 까서 유출될 수 있어서
// 반드시 백엔드를 거쳐서만 호출한다. 트라이얼(5일 €9.99) → Starter(월 €149) 자동전환 계약이라
// 실제로 계속 쓸지 확정되면 .env의 ENCAR_API_KEY만 갱신하면 됨(코드 변경 불필요).
@Injectable()
export class CarSpecService {
  private readonly logger = new Logger(CarSpecService.name);
  private readonly base = process.env.ENCAR_API_BASE || 'https://api.encarapi.com';
  private readonly apiKey = process.env.ENCAR_API_KEY || '';
  // EnCarAPI가 돌려주는 Photo 경로는 도메인이 없는 상대경로("/carpicture03/pic4243/42438787_")다.
  // 문서엔 CDN 호스트가 안 나와 있어서, 실제 매물 하나로 ci.encar.com / imgcar.encar.com 등을
  // 직접 테스트해 확인함(ci.encar.com만 200 + image/jpeg, CloudFront로 서빙됨).
  private readonly IMAGE_HOST = 'https://ci.encar.com';

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
  // 주의: 파라미터명이 "model"이 아니라 "model_group"이어야 한다(badge_group과 같은 규칙).
  // model=으로 보내면 조용히 무시되고, 일부 차종(예: 기아 스포티지)은 결과가 아예 0건으로
  // 나와서 실기기 테스트 중 발견함 — 반드시 model_group으로 유지할 것.
  async listings(manufacturer: string, model: string, badge?: string) {
    const data = await this.call('/api/catalog', {
      manufacturer,
      model_group: model,
      badge_group: badge,
      lang: 'ko',
      count: 'true',
    });
    const results = (data?.SearchResults ?? []) as any[];
    // 산점도 그래프(주행거리별 시세 추세선)를 그리려면 표본이 어느 정도 있어야 해서
    // 기존 20건 → 60건으로 늘림(회귀선 계산은 프론트에서 함, 여기선 표본만 더 줌).
    return results.slice(0, 60).map((r) => ({
      id: r.Id,
      model: r.Model,
      badge: r.Badge,
      year: r.FormYear,
      mileage: r.Mileage,
      fuel: r.FuelType,
      priceManwon: r.Price, // 만원 단위
      // r.Photo는 파일명 없는 접두 경로("..._")라 대표사진(001) 파일명을 붙여서 완성한다.
      thumbnailUrl: r.Photo ? `${this.IMAGE_HOST}${r.Photo}001.jpg` : null,
    }));
  }

  // listings()로 받은 매물 id로 상세 조회 — 실사진, 출고가, 사고/성능점검 여부, 옵션까지 나옴.
  // 주의: 이 vehicleId는 EnCar에 실제로 올라온 "매물"의 id다. 진단 중인 고객 차량의 차대번호(VIN)로
  // 조회하는 게 아니라, listings()가 돌려준 비교매물 중 하나를 더 자세히 보고 싶을 때만 쓸 수 있다.
  async vehicleDetail(id: string) {
    const data = await this.call(`/api/vehicle/${id}`, {});
    if (!data) return null;
    return {
      id: data.vehicleId,
      manufacturer: data.category?.manufacturerName,
      model: data.category?.modelName,
      grade: data.category?.gradeName,
      year: data.category?.formYear,
      originPriceManwon: data.category?.originPrice ?? null,
      mileage: data.spec?.mileage,
      displacement: data.spec?.displacement,
      transmission: data.spec?.transmissionName,
      fuel: data.spec?.fuelName,
      color: data.spec?.colorName,
      body: data.spec?.bodyName,
      seatCount: data.spec?.seatCount,
      priceManwon: data.advertisement?.price ?? null,
      status: data.advertisement?.status ?? null,
      hasAccidentRecord: !!data.condition?.accident?.recordView,
      hasInspectionRecord: Array.isArray(data.condition?.inspection?.formats) && data.condition.inspection.formats.length > 0,
      simpleRepair: !!data.condition?.simpleRepair,
      photoUrls: Array.isArray(data.photos)
        ? data.photos.map((p: any) => `${this.IMAGE_HOST}${p.location}`)
        : [],
    };
  }
}
