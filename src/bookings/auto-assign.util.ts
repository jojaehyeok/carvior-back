import * as https from 'https';

// 대시보드 지도(diagnosis/map.tsx)의 활성 진단사 판단 로직과 동일 —
// 가용 요일/시간을 벗어나면 비활성, 스케줄 미설정이면 최근 3시간 GPS로 폴백
export function isDriverActiveNow(d: {
  availableDays?: number[] | null;
  availableStartTime?: string | null;
  availableEndTime?: string | null;
  lastSeenAt?: Date | string | null;
}): boolean {
  const now = new Date();
  if (d.availableDays && d.availableDays.length > 0) {
    if (!d.availableDays.includes(now.getDay())) return false;
    if (d.availableStartTime && d.availableEndTime) {
      const cur = now.getHours() * 60 + now.getMinutes();
      const [sh, sm] = d.availableStartTime.split(':').map(Number);
      const [eh, em] = d.availableEndTime.split(':').map(Number);
      const start = sh * 60 + sm;
      const end = eh * 60 + em;
      return start <= end ? cur >= start && cur <= end : cur >= start || cur <= end;
    }
    return true;
  }
  return !!(d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < 3 * 60 * 60 * 1000);
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
