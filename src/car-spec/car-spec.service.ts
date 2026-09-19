import { Injectable, Logger } from '@nestjs/common';

// 회귀선(주행거리별 시세 추세)에 쓸 비교매물 표본 수.
const LISTING_SAMPLE_SIZE = 60;
// 세대 목록을 뽑기 위해 한 번에 떠보는 매물 수 — 표본이 작으면 매물이 적은 구형 세대가
// 목록에서 통째로 빠지기 때문에 넉넉하게 잡는다(limit=500까지 정상 응답 확인).
const GENERATION_SAMPLE_SIZE = 300;

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

  // 같은 모델그룹(예: 스포티지) 안에 있는 세대 목록을 뽑는다 — "NQ5 / 더 볼드 / 4세대..." 처럼
  // 세대에 따라 시세가 완전히 다른데, /api/model-search는 세대(model)를 안 돌려주기 때문에
  // catalog를 크게 한 번 떠서 실제 매물의 Model 값을 집계하는 방식으로 만든다.
  // (EnCarAPI에 세대 목록 전용 엔드포인트가 없어서 이 방법밖에 없음 — /api/models 등은 404)
  async generations(manufacturer: string, model: string, badge?: string) {
    const data = await this.call('/api/catalog', {
      manufacturer,
      model_group: model,
      badge_group: badge,
      lang: 'ko',
      count: 'true',
      limit: String(GENERATION_SAMPLE_SIZE),
    });
    const results = (data?.SearchResults ?? []) as any[];
    const byGeneration = new Map<string, { generation: string; count: number; yearMin: number; yearMax: number }>();
    for (const r of results) {
      const generation = r.Model;
      if (!generation) continue;
      const year = Number(r.FormYear) || 0;
      const hit = byGeneration.get(generation);
      if (!hit) {
        byGeneration.set(generation, { generation, count: 1, yearMin: year, yearMax: year });
      } else {
        hit.count += 1;
        if (year) {
          if (!hit.yearMin || year < hit.yearMin) hit.yearMin = year;
          if (year > hit.yearMax) hit.yearMax = year;
        }
      }
    }
    // 매물 많은 세대부터 — count는 표본(최대 GENERATION_SAMPLE_SIZE건) 안에서의 건수라
    // 전체 매물 수가 아니라 "이 세대가 얼마나 흔한지"의 상대적 지표로만 쓴다.
    return [...byGeneration.values()].sort((a, b) => b.count - a.count);
  }

  // 제조사/모델(+트림, +세대)로 실제 비교 매물(제원+실거래 시세)을 가져온다.
  // 주의: 모델그룹은 파라미터명이 "model"이 아니라 "model_group"이어야 한다(badge_group과 같은 규칙).
  // 반면 "model"은 세대(예: "스포티지 더 볼드") 필터로 실제 동작한다 — 예전 주석엔 무시된다고
  // 적혀 있었지만 확인 결과 정상 동작함(스포티지 전체 4077건 → 더 볼드 682건). model_group을
  // 빼고 model만 보내면 0건이 나오므로, 반드시 model_group과 같이 보낼 것.
  async listings(manufacturer: string, model: string, badge?: string, generation?: string) {
    const data = await this.call('/api/catalog', {
      manufacturer,
      model_group: model,
      badge_group: badge,
      model: generation,
      lang: 'ko',
      count: 'true',
      // limit을 안 보내면 EnCarAPI 기본값이 20건이라, 아래 slice(0, 60)이 여태 아무 일도
      // 하지 않고 표본이 20건뿐이었다. 회귀선 표본을 실제로 60건 받으려면 이걸 보내야 한다.
      limit: String(LISTING_SAMPLE_SIZE),
    });
    const results = (data?.SearchResults ?? []) as any[];
    // 산점도 그래프(주행거리별 시세 추세선)를 그리려면 표본이 어느 정도 있어야 해서
    // 기존 20건 → 60건으로 늘림(회귀선 계산은 프론트에서 함, 여기선 표본만 더 줌).
    return results.slice(0, LISTING_SAMPLE_SIZE).map((r) => ({
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
