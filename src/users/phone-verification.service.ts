import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { SolapiService } from '../solapi/solapi.service';

/**
 * 휴대폰 번호 인증 — "다른 번호로 신청한 검차 건을 내 계정에 붙이기"에 쓴다.
 *
 * 검차 예약(bookings)에는 userId가 없고 접수할 때 적은 번호(contact)만 있다.
 * 그래서 마이페이지는 "가입한 번호 == 접수한 번호"인 건만 보여준다.
 * 다른 번호로 접수한 건을 보려면 그 번호가 본인 것임을 확인해야 한다 —
 * ⚠ 인증 없이 번호만 받으면 남의 번호를 넣어 남의 검차 이력(차량번호·주소·연락처)을
 * 그대로 들여다볼 수 있다. 그래서 인증이 선택이 아니라 필수다.
 *
 * 코드는 메모리에 둔다. 서버가 재시작되면 날아가지만 유효기간이 3분이라
 * 다시 받으면 그만이고, 이것 때문에 테이블을 하나 더 만들 이유는 없다.
 */
@Injectable()
export class PhoneVerificationService {
  private readonly logger = new Logger(PhoneVerificationService.name);

  private readonly TTL_MS = 3 * 60 * 1000;
  private readonly MAX_ATTEMPTS = 5;
  // 같은 번호로 1분에 한 번만 보낸다(문자 요금이 나가고, 남의 번호로 장난치는 것도 막는다)
  private readonly RESEND_COOLDOWN_MS = 60 * 1000;

  private readonly codes = new Map<
    string,
    { code: string; expiresAt: number; attempts: number; sentAt: number }
  >();

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly solapi: SolapiService,
  ) {}

  private normalize(phone: string) {
    return (phone ?? '').replace(/[^0-9]/g, '');
  }

  async send(rawPhone: string) {
    const phone = this.normalize(rawPhone);
    if (!/^01[0-9]{8,9}$/.test(phone)) {
      throw new BadRequestException('휴대폰 번호를 다시 확인해주세요.');
    }

    const existing = this.codes.get(phone);
    if (existing && Date.now() - existing.sentAt < this.RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((this.RESEND_COOLDOWN_MS - (Date.now() - existing.sentAt)) / 1000);
      throw new BadRequestException(`${wait}초 뒤에 다시 요청해주세요.`);
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    this.codes.set(phone, {
      code,
      expiresAt: Date.now() + this.TTL_MS,
      attempts: 0,
      sentAt: Date.now(),
    });

    await this.solapi.sendSms(phone, `[카비어] 인증번호 ${code} (3분 내 입력)`);
    this.logger.log(`[번호인증] 발송 → ${phone.slice(0, 3)}****${phone.slice(-4)}`);
    return { ok: true, expiresInSec: this.TTL_MS / 1000 };
  }

  /**
   * 인증 확인 → 성공하면 그 번호를 이 회원의 "추가 번호"로 저장한다.
   * 가입할 때 쓴 번호(users.phone)는 그대로 두고 altPhones에만 쌓는다 —
   * 로그인·알림 등 기존 동작이 전부 users.phone을 기준으로 돌기 때문이다.
   */
  async confirm(userId: number, rawPhone: string, inputCode: string) {
    const phone = this.normalize(rawPhone);
    const entry = this.codes.get(phone);

    if (!entry || entry.expiresAt < Date.now()) {
      this.codes.delete(phone);
      throw new BadRequestException('인증번호가 만료되었습니다. 다시 받아주세요.');
    }
    if (entry.attempts >= this.MAX_ATTEMPTS) {
      this.codes.delete(phone);
      throw new BadRequestException('입력 횟수를 초과했습니다. 다시 받아주세요.');
    }
    entry.attempts += 1;
    if (entry.code !== this.normalize(inputCode)) {
      throw new BadRequestException('인증번호가 맞지 않습니다.');
    }

    this.codes.delete(phone);

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('회원 정보를 찾을 수 없습니다.');

    const current = user.altPhones ?? [];
    const already = this.normalize(user.phone) === phone || current.some(p => this.normalize(p) === phone);
    if (!already) {
      user.altPhones = [...current, phone];
      await this.users.save(user);
    }

    return { ok: true, phone, phones: this.phonesOf(user) };
  }

  // 이 회원이 본인 것으로 확인한 번호 전부(가입 번호 + 인증한 추가 번호)
  phonesOf(user: User): string[] {
    const all = [user.phone, ...(user.altPhones ?? [])]
      .map(p => this.normalize(p))
      .filter(Boolean);
    return [...new Set(all)];
  }

  async phonesForUser(userId: number): Promise<string[]> {
    const user = await this.users.findOne({ where: { id: userId } });
    return user ? this.phonesOf(user) : [];
  }
}
