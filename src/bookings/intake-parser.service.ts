import { Injectable, BadRequestException } from '@nestjs/common';

// 딜러가 카톡으로 보내온 접수 내용을 간편신청 폼 항목으로 옮겨주는 파서.
//
// 카톡 메시지가 "차량번호 : 31루 8635"처럼 어느 정도 형식이 있어서 규칙만으로 처리한다.
// 외부 AI를 쓰지 않으므로 비용도, 호출 실패로 접수가 막히는 일도 없다.
//
// 사람이 화면에서 확인하고 제출하는 전제라, 확실하지 않은 값은 지어내지 않고 비워둔다 —
// 틀린 값이 채워진 채 접수되는 게 빈 칸보다 나쁘다.
@Injectable()
export class IntakeParserService {
  // 폼에 있는 칸만 돌려준다. 여기 없는 정보(차종·주행거리·색상 등)는 additionalMemo로 모은다.
  private readonly FIELDS = [
    'carNumber', 'carOwner', 'carYear', 'desiredPrice', 'dealerName',
    'contact', 'customerContact', 'address', 'detailAddress',
    'vehicleCategory', 'additionalMemo',
  ] as const;

  // 줄 앞에 붙은 "1." "2)" 같은 번호를 떼어낸다.
  private stripNumbering(line: string): string {
    let i = 0;
    while (i < line.length && line[i] >= '0' && line[i] <= '9') i++;
    if (i > 0 && i < line.length && (line[i] === '.' || line[i] === ')')) return line.slice(i + 1).trim();
    return line;
  }

  // 줄 첫머리가 이 라벨이면 뒤에 오는 값을 돌려준다(아니면 null).
  // 띄어쓰기는 무시하고 비교한다 — "차주 연락처", "차주연락처"가 섞여 온다.
  private afterLabel(line: string, label: string): string | null {
    let i = 0;
    let j = 0;
    while (j < label.length) {
      if (label[j] === ' ') { j++; continue; }
      if (i < line.length && line[i] === ' ') { i++; continue; }
      if (i >= line.length || line[i] !== label[j]) return null;
      i++; j++;
    }
    let rest = line.slice(i).trim();
    const hasColon = rest.startsWith(':') || rest.startsWith('：');
    while (rest.startsWith(':') || rest.startsWith('：')) rest = rest.slice(1).trim();
    // 콜론이 없으면 라벨이 더 긴 낱말의 앞부분일 수 있다("사고"가 "사고유무 : ..."에 걸린다).
    // 콜론 없이 이어지는 값은 전화번호·금액처럼 숫자로 시작할 때만 인정한다.
    if (!hasColon && !(rest[0] >= '0' && rest[0] <= '9')) return null;
    return rest;
  }

  // 라벨로 값을 찾는다. 정규식을 문자열로 조립하면 라벨에 든 기호가 패턴으로 해석돼
  // 엉뚱하게 매칭되므로 직접 잘라서 비교한다.
  private pick(text: string, labels: string[]): string {
    const lines = text.split('\n').map(raw => this.stripNumbering(raw.trim())).filter(Boolean);
    for (const label of labels) {
      for (const line of lines) {
        const rest = this.afterLabel(line, label);
        if (rest) return rest;
      }
    }
    return '';
  }

  private digits(v: string): string {
    return (v || '').replace(/[^0-9]/g, '');
  }

  private ruleParse(text: string): Record<string, string> {
    const f: Record<string, string> = {};
    for (const key of this.FIELDS) f[key] = '';

    // 차량번호 — "31루 8635", "123가4567" 형태. 라벨이 없어도 본문에서 찾는다.
    const plate = this.pick(text, ['차량번호', '차번', '번호']) || text.match(/[0-9]{2,3}\s?[가-힣]\s?[0-9]{4}/)?.[0] || '';
    if (plate && !plate.includes('미정')) {
      f.carNumber = (plate.match(/[0-9]{2,3}\s?[가-힣]\s?[0-9]{4}/)?.[0] || '').replace(/\s/g, '');
    }

    // 연락처 — "차주/고객/소유자"가 붙은 번호는 고객, 그 외는 딜러로 본다.
    const ownerPhone = this.pick(text, ['차주 연락처', '고객 연락처', '소유자 연락처', '차주', '고객', '소유자']);
    if (/[0-9]/.test(ownerPhone)) f.customerContact = this.digits(ownerPhone).slice(0, 11);
    const dealerPhone = this.pick(text, ['딜러 연락처', '딜러', '담당자', '연락처']);
    if (/[0-9]/.test(dealerPhone)) {
      const d = this.digits(dealerPhone).slice(0, 11);
      if (d !== f.customerContact) f.contact = d;
    }

    const owner = this.pick(text, ['차주 성함', '소유자', '차주명', '고객명']);
    if (owner && !/[0-9]/.test(owner)) f.carOwner = owner;

    const dealer = this.pick(text, ['딜러명', '상사명', '담당']);
    if (dealer && !/[0-9]/.test(dealer)) f.dealerName = dealer;

    // 연식 — "2011년 8월(2012년식)"이면 년식(2012)을 우선한다.
    const yearLine = this.pick(text, ['연식', '년식']);
    f.carYear = yearLine.match(/([0-9]{4})\s*년식/)?.[1] || yearLine.match(/[0-9]{4}/)?.[0] || '';

    const price = this.pick(text, ['희망가', '희망 금액', '가격']);
    if (price) f.desiredPrice = this.digits(price.replace(/만\s*원?/g, ''));

    const category = this.pick(text, ['차종']);
    if (/포터|봉고|화물/.test(category)) f.vehicleCategory = '포터·봉고';

    // 같은 값이 두 라벨에 걸리는 경우가 있다("사고유무"가 "사고"에도 잡힘) — 값 기준으로 한 번만 담는다.
    const seen = new Set<string>();
    const memo: string[] = [];
    for (const label of ['차종', '모델', '주행거리', '색상', '사고유무', '사고', '요청사항', '특이사항']) {
      const v = this.pick(text, [label]);
      if (!v || seen.has(v)) continue;
      seen.add(v);
      memo.push(`${label}: ${v}`);
    }
    if (memo.length) f.additionalMemo = memo.join(' / ');

    // 주소 — 라벨이 있으면 그걸 쓰고, 없으면 주소처럼 보이는 줄을 후보로 올린다.
    // 지번·도로명이 우선이고 없으면 전시장·상사 상호가 적힌 줄을 쓴다. 어차피 사람이
    // 검색으로 확정하므로 후보만 올려주면 된다(틀린 주소가 그대로 확정되지는 않는다).
    const labelled = this.pick(text, ['주소', '위치', '장소', '방문지']);
    if (labelled) {
      f.address = labelled;
    } else {
      const plain = text.split('\n').map(l => l.trim()).filter(l => l && !/[:：]/.test(l) && l.length <= 40);
      const byNumber = plain.find(l => /(동|로|길)\s?[0-9]/.test(l));
      const byPlace = plain.find(l => /(전시장|상사|모터스|오토|센터|지점|매장|공장|주차장)/.test(l));
      if (byNumber || byPlace) f.address = byNumber ?? byPlace ?? '';
    }

    const detail = this.pick(text, ['상세주소', '상세 위치', '동호수']);
    if (detail) f.detailAddress = detail;

    return f;
  }

  parse(text: string): { fields: Record<string, string>; filledCount: number } {
    const body = (text || '').trim();
    if (!body) throw new BadRequestException('붙여넣을 내용이 없습니다.');
    // 대화 전체를 통째로 붙여넣으면 여러 건이 섞여 엉뚱하게 채워진다 — 길이로 먼저 막는다.
    if (body.length > 3000) {
      throw new BadRequestException('내용이 너무 깁니다. 접수 건 하나만 붙여넣어 주세요.');
    }

    const fields = this.ruleParse(body);
    const filledCount = Object.values(fields).filter(Boolean).length;
    console.log(`📝 [접수 파싱] ${filledCount}개 항목 (입력 ${body.length}자)`);
    return { fields, filledCount };
  }
}
