import { Injectable, BadRequestException } from '@nestjs/common';

// 딜러가 카톡으로 보내온 접수 내용을 간편신청 폼 항목으로 옮겨주는 파서.
//
// 형식이 제각각이다 — 번호 목록("1. 차종 : ..."), 글머리표("◆ 차량번호 : ..."),
// 카톡 대화 내보내기("[벤츠서초이광직] [오후 4:18] ..."), 연락처 공유("이름: / 휴대전화:"),
// 장소만 한 줄("한성 광교"). 외부 AI 없이 규칙으로 처리한다.
//
// 사람이 화면에서 확인하고 제출하는 전제라, 확실하지 않은 값은 지어내지 않고 비워둔다 —
// 틀린 값이 채워진 채 접수되는 게 빈 칸보다 나쁘다.
@Injectable()
export class IntakeParserService {
  // 폼에 있는 칸만 돌려준다. 여기 없는 정보(주행거리·색상 등)는 additionalMemo로 모은다.
  private readonly FIELDS = [
    'carNumber', 'carOwner', 'carModel', 'carYear', 'desiredPrice', 'dealerName',
    'contact', 'customerContact', 'address', 'detailAddress', 'additionalMemo',
  ] as const;

  // 우리 쪽 계정 이름은 딜러가 아니다(카톡 말머리에서 딜러를 고를 때 제외).
  private readonly OURS = /anyone|애니원|카비어|carvior/i;

  // 줄 앞의 번호("1." "2)")와 글머리표("◆" "■" "-")를 떼어낸다.
  private stripNumbering(line: string): string {
    let i = 0;
    while (i < line.length && line[i] >= '0' && line[i] <= '9') i++;
    if (i > 0 && i < line.length && (line[i] === '.' || line[i] === ')')) return line.slice(i + 1).trim();
    return line;
  }

  private stripBullet(line: string): string {
    return this.stripNumbering(line.replace(/^[◆◇■□▪▫●○★☆▶▷•·※*\-–—]+\s*/, '').trim());
  }

  // 카톡 대화를 통째로 붙여넣는 경우가 많다. 말머리에서 보낸 사람을 모아두고(딜러 후보)
  // 본문만 남긴다.
  private preprocess(text: string): { lines: string[]; speakers: string[] } {
    const lines: string[] = [];
    const speakers: string[] = [];
    for (const raw of text.split('\n')) {
      let line = raw.trim();
      if (!line) continue;
      const talk = line.match(/^\[([^\]]+)\]\s*\[(?:오전|오후)\s*[0-9]{1,2}:[0-9]{2}\]\s*(.*)$/);
      if (talk) {
        speakers.push(talk[1].trim());
        line = talk[2].trim();
      }
      line = this.stripBullet(line);
      if (line) lines.push(line);
    }
    return { lines, speakers };
  }

  // 줄 첫머리가 이 라벨이면 뒤에 오는 값을 돌려준다(라벨이 아니면 null, 값이 비면 빈 문자열).
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
    if (rest === '') return '';
    // 콜론이 없으면 라벨이 더 긴 낱말의 앞부분일 수 있다("사고"가 "사고유무 : ..."에 걸린다).
    // 콜론 없이 이어지는 값은 전화번호·금액처럼 숫자로 시작할 때만 인정한다.
    if (!hasColon && !(rest[0] >= '0' && rest[0] <= '9')) return null;
    return rest;
  }

  private isLabelLine(line: string): boolean {
    return line.includes(':') || line.includes('：');
  }

  // 라벨로 값을 찾는다. 정규식을 문자열로 조립하면 라벨에 든 기호가 패턴으로 해석돼
  // 엉뚱하게 매칭되므로 직접 잘라서 비교한다.
  // nextLine: 값이 비어 있으면 다음 줄을 값으로 본다("제조사, 이름, 등급" 아래에 차량명).
  private pick(lines: string[], labels: string[], nextLine = false): string {
    for (const label of labels) {
      for (let i = 0; i < lines.length; i++) {
        const rest = this.afterLabel(lines[i], label);
        if (rest === null) continue;
        if (rest) return rest;
        if (nextLine) {
          const next = lines[i + 1];
          if (next && !this.isLabelLine(next)) return next;
        }
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
    const { lines, speakers } = this.preprocess(text);
    const joined = lines.join('\n');

    // 차량번호 — "31루 8635", "123가4567" 형태. 라벨이 없어도 본문에서 찾는다.
    const plate = this.pick(lines, ['차량번호', '차번', '번호']) || joined.match(/[0-9]{2,3}\s?[가-힣]\s?[0-9]{4}/)?.[0] || '';
    if (plate && !plate.includes('미정')) {
      f.carNumber = (plate.match(/[0-9]{2,3}\s?[가-힣]\s?[0-9]{4}/)?.[0] || '').replace(/\s/g, '');
    }

    // 고객 이름 — "이름: 심옥희 S450L 출고고객"처럼 뒤에 차량명·호칭이 붙어 온다.
    const nameLine = this.pick(lines, ['차주 성함', '소유자', '차주명', '고객명', '성함', '이름']);
    if (nameLine) {
      const parts = nameLine.split(' ').filter(Boolean);
      if (/^[가-힣]{2,4}$/.test(parts[0])) {
        f.carOwner = parts[0];
        // 이름 뒤에 남는 말에서 호칭을 걷어내면 차량명이 남는 경우가 많다.
        const rest = parts.slice(1).filter(p => !/(고객|출고|사장|님|차주|소유자)/.test(p)).join(' ').trim();
        if (rest) f.carModel = rest;
      }
    }

    // 차량명 — "제조사, 이름, 등급" 아래 줄에 적어 보내는 양식이 있다.
    if (!f.carModel) {
      const model = this.pick(lines, ['제조사, 이름, 등급', '제조사', '차량명', '모델명', '모델', '차종'], true);
      if (model) f.carModel = model;
    }

    // 연락처 — "차주/고객/소유자/휴대전화"가 붙은 번호는 고객, 나머지는 딜러로 본다.
    const ownerPhone = this.pick(lines, ['차주 연락처', '고객 연락처', '소유자 연락처', '휴대전화', '휴대폰', '핸드폰', '차주', '고객', '소유자']);
    if (/[0-9]/.test(ownerPhone)) f.customerContact = this.digits(ownerPhone).slice(0, 11);
    const dealerPhone = this.pick(lines, ['딜러 연락처', '딜러', '담당자', '연락처', '전화번호']);
    if (/[0-9]/.test(dealerPhone)) {
      const d = this.digits(dealerPhone).slice(0, 11);
      if (d !== f.customerContact) f.contact = d;
    }
    // 라벨 없이 전화번호만 한 줄로 오는 경우(명함 형식) — 딜러 번호로 본다.
    if (!f.contact) {
      const bare = lines.find(l => /^01[0-9][-\s.]?[0-9]{3,4}[-\s.]?[0-9]{4}$/.test(l));
      const d = bare ? this.digits(bare) : '';
      if (d && d !== f.customerContact) f.contact = d;
    }

    // 딜러 이름 — 카톡 말머리(보낸 사람)가 가장 정확하다. 없으면 "김진백 차장" 줄에서 뽑는다.
    const speaker = speakers.find(s => !this.OURS.test(s));
    if (speaker) {
      f.dealerName = speaker;
    } else {
      const titled = lines.find(l => /^[가-힣]{2,4}\s?(차장|부장|과장|대리|팀장|사장|실장|소장|이사|대표)$/.test(l));
      if (titled) f.dealerName = titled.trim();
      else {
        const labelled = this.pick(lines, ['딜러명', '상사명', '담당']);
        if (labelled && !/[0-9]/.test(labelled)) f.dealerName = labelled;
      }
    }

    // 연식 — "2018년 4 월 / 2018년식"이면 년식(2018)을 우선한다.
    const yearLine = this.pick(lines, ['연식', '년식', '등록,년식', '등록년식', '등록']);
    f.carYear = yearLine.match(/([0-9]{4})\s*년\s*식/)?.[1] || yearLine.match(/[0-9]{4}/)?.[0] || '';

    const price = this.pick(lines, ['희망가', '희망 금액', '가격']);
    if (price) f.desiredPrice = this.digits(price.replace(/만\s*원?/g, ''));

    // 같은 값이 두 라벨에 걸리는 경우가 있다("사고유무"가 "사고"에도 잡힘) — 값 기준으로 한 번만 담는다.
    const seen = new Set<string>();
    const memo: string[] = [];
    for (const label of ['주행거리', '색상', '사고유무', '사고 유무 상세 내용', '사고', '리스 또는 렌트 사용 여부', '요청사항', '특이사항']) {
      const v = this.pick(lines, [label]);
      if (!v || seen.has(v)) continue;
      seen.add(v);
      memo.push(`${label}: ${v}`);
    }
    if (memo.length) f.additionalMemo = memo.join(' / ');

    // 주소 — 라벨이 있으면 그걸 쓰고, 없으면 주소처럼 보이는 줄을 후보로 올린다.
    // 어차피 사람이 검색으로 확정하므로 후보만 올려주면 된다.
    const labelledAddr = this.pick(lines, ['주소', '위치', '장소', '방문지']);
    if (labelledAddr) {
      f.address = labelledAddr;
    } else {
      const plain = lines.filter(l => !this.isLabelLine(l) && l.length <= 40);
      const byNumber = plain.find(l => /(동|로|길)\s?[0-9]/.test(l));
      const byPlace = plain.find(l => /(전시장|상사|모터스|오토|센터|지점|매장|공장|주차장|한성|도이치|코오롱|효성|바바리안|갤러리)/.test(l));
      if (byNumber || byPlace) f.address = byNumber ?? byPlace ?? '';
    }

    const detail = this.pick(lines, ['상세주소', '상세 위치', '동호수']);
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
