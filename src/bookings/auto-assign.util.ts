import * as https from 'https';

// preferredDateTime("YYYY-MM-DD HH:mm", KST 벽시계 문자열)에서 요일·분단위 시각을 뽑아냄.
// 파싱 실패 시 null — 호출부에서 "지금" 기준으로 폴백.
function parseKstDayAndMinutes(dateTimeStr?: string | null): { day: number; minutes: number } | null {
  const match = dateTimeStr?.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  // 순수 달력 요일 계산이라 타임존 영향 없음 — Date.UTC로 계산해도 실제 KST 날짜의 요일과 같음
  const day = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return { day, minutes: h * 60 + mi };
}

// 대시보드 지도(diagnosis/map.tsx)의 "지금 활성" 판단과는 다르게, 자동배정에서는 접수 시점이
// 아니라 실제 방문예정일시(referenceDateTime) 기준으로 스케줄을 체크한다 — 안 그러면 저녁에
// 접수된 건이 "지금(접수 시점)은 근무 외 시간"이라는 이유만으로 무조건 자동배정에서 제외돼서,
// 방문일이 며칠 뒤라 실제로는 그 진단사가 근무 중일 시간이어도 후보에서 부당하게 빠지는 문제가 있었음.
// referenceDateTime을 안 주면(예: 지도 화면의 실시간 표시) 기존처럼 "지금"을 기준으로 판단.
export function isDriverActiveNow(
  d: {
    availableDays?: number[] | null;
    availableStartTime?: string | null;
    availableEndTime?: string | null;
    lastSeenAt?: Date | string | null;
  },
  referenceDateTime?: string | null,
): boolean {
  // new Date().getDay()/getHours()는 서버 로컬 타임존 기준인데, 배포 서버는 UTC로 돌고 있어서
  // 진단사가 입력한 가용시간(한국시간 기준, 예: 08:00~20:00)과 그대로 비교하면 9시간이 밀려
  // 실제로는 활성 시간대인데도 비활성으로 잘못 판정됨 — 서버 타임존과 무관하게 항상 KST로 계산.
  const parsed = parseKstDayAndMinutes(referenceDateTime);
  let day: number;
  let cur: number;
  if (parsed) {
    ({ day, minutes: cur } = parsed);
  } else {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    day = kst.getUTCDay();
    cur = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  }

  if (d.availableDays && d.availableDays.length > 0) {
    if (!d.availableDays.includes(day)) return false;
    if (d.availableStartTime && d.availableEndTime) {
      const [sh, sm] = d.availableStartTime.split(':').map(Number);
      const [eh, em] = d.availableEndTime.split(':').map(Number);
      const start = sh * 60 + sm;
      const end = eh * 60 + em;
      return start <= end ? cur >= start && cur <= end : cur >= start || cur <= end;
    }
    return true;
  }
  // 스케줄 미설정 시의 "최근 3시간 GPS 활동" 폴백은 미래 방문일을 알 수 없는 값이라
  // 방문예정일과 무관하게 항상 "지금" 기준으로 판단
  return !!(d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < 3 * 60 * 60 * 1000);
}

// 스케줄상 근무시간이고 isActive라도, 위치 갱신이 너무 오래 안 되면(앱 강제종료·백그라운드
// 스로틀링 등) 실제로 자리를 비웠을 가능성이 높으니 자동배정·신규접수 알림 후보에서 제외.
// 앱을 다시 켜면 즉시 위치가 갱신되니 다음 예약부터 바로 정상 복귀됨(영구 제외 아님).
// (30분은 2분 간격 GPS 핑도 잠깐 밀리면 걸릴 만큼 빡빡해서 3시간으로 완화)
const STALE_LOCATION_MS = 3 * 60 * 60 * 1000;

export function isLocationFresh(d: { lastSeenAt?: Date | string | null }): boolean {
  return !!(d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() <= STALE_LOCATION_MS);
}

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 대시보드 지도에서 쓰는 카카오 REST 키와 동일 (이미 브라우저 번들에 노출되어 있던 공개 키)
const KAKAO_REST_KEY = '5d73c6482159874735a29becf6849e11';

function httpsGetJson(url: string, headers: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('카카오 지오코딩 타임아웃')));
  });
}

// 서버 사이드 주소 → 좌표 변환. 실패해도 예외를 던지지 않고 null 반환 —
// 자동배정은 거리 계산이 안 되면 다른 기준(오늘 배정건수)으로 폴백하면 되므로 신청 접수 자체를 막으면 안 됨
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!address) return null;
  try {
    const q = encodeURIComponent(address);
    const data = await httpsGetJson(`https://dapi.kakao.com/v2/local/search/address.json?query=${q}`, {
      Authorization: `KakaoAK ${KAKAO_REST_KEY}`,
    });
    const doc = data?.documents?.[0];
    if (doc) return { lat: parseFloat(doc.y), lng: parseFloat(doc.x) };

    const data2 = await httpsGetJson(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${q}`, {
      Authorization: `KakaoAK ${KAKAO_REST_KEY}`,
    });
    const doc2 = data2?.documents?.[0];
    if (doc2) return { lat: parseFloat(doc2.y), lng: parseFloat(doc2.x) };

    return null;
  } catch {
    return null;
  }
}
