import { BadRequestException, Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { User } from './entities/user.entity';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  // 고객용 네이티브 앱 전용 — 웹은 계속 NextAuth 자체 세션을 쓰므로 영향 없음.
  // JWT_SECRET이 서버 .env에 없으면 jwt.sign()이 그대로 던져서 로그인 자체가 500으로
  // 죽는 사고가 있었음(2026-08-18) — 토큰 발급 실패가 로그인 성공 여부를 막으면 안 되므로
  // 반드시 여기서 흡수하고 빈 문자열로 대체한다(고객앱 토큰 저장만 실패, 웹 로그인은 정상).
  private issueToken(userId: number): string {
    try {
      return this.jwt.sign({ sub: userId });
    } catch (e) {
      return '';
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email } });
  }

  async findById(id: number): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  async register(data: {
    email: string;
    password: string;
    name: string;
    phone?: string;
    role?: string;
    company?: string | null;
    logoUrl?: string | null;
    isExportOnly?: boolean;
    canConfirmBilling?: boolean;
    dealerLicenseUrl?: string;
    businessRegUrl?: string;
    businessNumber?: string;
    companyName?: string;
    marketingConsent?: boolean;
  }): Promise<User & { token: string }> {
    const existing = await this.findByEmail(data.email);
    if (existing) throw new ConflictException('이미 사용 중인 이메일입니다.');

    const hashed = await bcrypt.hash(data.password, 10);
    const isDealer = data.role === 'dealer';
    const user = this.repo.create({
      email:             data.email,
      password:          hashed,
      name:              data.name,
      phone:             data.phone,
      role:              data.role ?? 'user',
      company:           data.company || null,
      logoUrl:           data.logoUrl || null,
      isExportOnly:      data.isExportOnly ?? false,
      canConfirmBilling: data.canConfirmBilling ?? false,
      provider:          'local',
      dealerLicenseUrl:  data.dealerLicenseUrl,
      businessRegUrl:    data.businessRegUrl,
      businessNumber:    data.businessNumber,
      companyName:       data.companyName,
      dealerStatus:      isDealer ? 'pending' : 'none',
      marketingConsent:  data.marketingConsent ?? false,
    });
    const saved = await this.repo.save(user);
    // save()는 select:false와 무관하게 넘겨받은 객체를 그대로 반환하므로
    // 해시된 비밀번호라도 응답에 남지 않게 명시적으로 제거한다
    const { password: _pw, ...safe } = saved as any;
    return { ...(safe as User), token: this.issueToken(saved.id) };
  }

  async login(email: string, password: string): Promise<User & { token: string }> {
    const user = await this.repo
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();

    if (!user) throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    const ok = await bcrypt.compare(password, user.password ?? '');
    if (!ok)  throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');

    const { password: _, ...safe } = user as any;
    // 웹은 이 응답에서 자기가 쓰는 필드만 읽고 나머지는 무시하므로 token 필드
    // 추가는 NextAuth CredentialsProvider 쪽에 영향 없음(고객용 앱 전용 필드)
    return { ...(safe as User), token: this.issueToken(user.id) };
  }

  async findOrCreateSocial(data: {
    provider: string;
    providerId: string;
    email?: string;
    name?: string;
    profileImage?: string;
  }): Promise<User & { token: string }> {
    let user = await this.repo.findOne({
      where: { provider: data.provider, providerId: data.providerId },
    });
    if (!user && data.email) {
      user = await this.repo.findOne({ where: { email: data.email } });
    }
    let saved: User;
    if (user) {
      user.provider   = data.provider;
      user.providerId = data.providerId;
      if (data.name)         user.name         = data.name;
      if (data.profileImage) user.profileImage = data.profileImage;
      saved = await this.repo.save(user);
    } else {
      const newUser = this.repo.create({
        provider:     data.provider,
        providerId:   data.providerId,
        email:        data.email,
        name:         data.name,
        profileImage: data.profileImage,
      });
      saved = await this.repo.save(newUser);
    }
    return { ...saved, token: this.issueToken(saved.id) };
  }

  async findAll(): Promise<User[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async updateRole(id: number, role: string): Promise<User> {
    const user = await this.repo.findOneBy({ id });
    if (!user) throw new UnauthorizedException('유저를 찾을 수 없습니다.');
    user.role = role;
    return this.repo.save(user);
  }

  async updatePassword(id: number, newPassword: string): Promise<void> {
    const user = await this.repo.findOneBy({ id });
    if (!user) throw new UnauthorizedException('유저를 찾을 수 없습니다.');
    user.password = await bcrypt.hash(newPassword, 10);
    await this.repo.save(user);
  }

  // 관리자 계정의 이름/연락처/발주사 코드 수정 — 만들고 나서 코드를 잘못 넣었을 때
  // 계정을 지우고 다시 만들 필요 없이 바로 고칠 수 있게 함
  async updateAdminInfo(id: number, data: { name?: string; phone?: string; company?: string | null; logoUrl?: string | null; profileImage?: string | null; isExportOnly?: boolean; canConfirmBilling?: boolean }): Promise<User> {
    const user = await this.repo.findOneBy({ id });
    if (!user) throw new UnauthorizedException('유저를 찾을 수 없습니다.');
    if (data.name !== undefined) user.name = data.name;
    if (data.phone !== undefined) user.phone = data.phone;
    if (data.company !== undefined) user.company = data.company || null;
    if (data.logoUrl !== undefined) user.logoUrl = data.logoUrl || null;
    if (data.profileImage !== undefined) user.profileImage = data.profileImage || null;
    if (data.isExportOnly !== undefined) user.isExportOnly = data.isExportOnly;
    if (data.canConfirmBilling !== undefined) user.canConfirmBilling = data.canConfirmBilling;
    return this.repo.save(user);
  }

  async updateMarketingConsent(id: number, consent: boolean): Promise<User> {
    const user = await this.repo.findOneBy({ id });
    if (!user) throw new UnauthorizedException('유저를 찾을 수 없습니다.');
    user.marketingConsent = consent;
    return this.repo.save(user);
  }

  async updateWebPushToken(id: number, webPushToken: string): Promise<void> {
    await this.repo.update(id, { webPushToken });
  }

  async updatePushToken(id: number, pushToken: string): Promise<void> {
    await this.repo.update(id, { pushToken });
  }

  async findAdmins(): Promise<User[]> {
    return this.repo.find({ where: { role: 'admin' }, order: { createdAt: 'DESC' } });
  }

  async findDealers(): Promise<User[]> {
    return this.repo.find({ where: { role: 'dealer' }, order: { createdAt: 'DESC' } });
  }

  async updateDealerStatus(id: number, status: string): Promise<User> {
    const ALLOWED = ['none', 'pending', 'approved', 'rejected'];
    if (!ALLOWED.includes(status)) throw new BadRequestException('잘못된 상태값입니다.');
    const user = await this.repo.findOneBy({ id });
    if (!user) throw new UnauthorizedException('유저를 찾을 수 없습니다.');
    user.dealerStatus = status;
    return this.repo.save(user);
  }

  async applyDealer(id: number, data: {
    dealerLicenseUrl: string;
    businessRegUrl?: string;
    businessNumber?: string;
    companyName?: string;
  }): Promise<User> {
    if (!data.dealerLicenseUrl) throw new BadRequestException('자동차 매매종사원증을 업로드해주세요.');
    const user = await this.repo.findOneBy({ id });
    if (!user) throw new UnauthorizedException('유저를 찾을 수 없습니다.');
    user.role             = 'dealer';
    user.dealerLicenseUrl = data.dealerLicenseUrl;
    if (data.businessRegUrl) user.businessRegUrl = data.businessRegUrl;
    if (data.businessNumber) user.businessNumber = data.businessNumber;
    if (data.companyName)    user.companyName    = data.companyName;
    user.dealerStatus = 'pending';
    return this.repo.save(user);
  }
}
