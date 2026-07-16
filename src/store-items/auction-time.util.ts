// 경매 마감시각 계산 — 기본 48시간, 진행 구간에 주말(토/일)이 하루라도
// 걸치면 72시간으로 연장.
function includesWeekend(start: Date, end: Date): boolean {
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);

  while (cur <= last) {
    const day = cur.getDay(); // 0=일, 6=토
    if (day === 0 || day === 6) return true;
    cur.setDate(cur.getDate() + 1);
  }
  return false;
}

export function computeAuctionEndAt(startAt: Date): Date {
  const base = new Date(startAt.getTime() + 48 * 60 * 60 * 1000);
  const hours = includesWeekend(startAt, base) ? 72 : 48;
  return new Date(startAt.getTime() + hours * 60 * 60 * 1000);
}
