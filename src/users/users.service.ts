import { BadRequestException, Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

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
    dealerLicenseUrl?: string;
    businessRegUrl?: string;
    businessNumber?: string;
    companyName?: string;
    marketingConsent?: boolean;
  }): Promise<User> {
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
      provider:          'local',
      dealerLicenseUrl:  data.dealerLicenseUrl,
      businessRegUrl:    data.businessRegUrl,
      businessNumber:    data.businessNumber,
      companyName:       data.companyName,
      dealerStatus:      isDealer ? 'pending' : 'none',
      marketingConsent:  data.marketingConsent ?? false,
    });
    return this.repo.save(user);
  }

  async login(email: string, password: string): Promise<User> {
    const user = await this.repo
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();

    if (!user) throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    const ok = await bcrypt.compare(password, user.password ?? '');
    if (!ok)  throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');

    const { password: _, ...safe } = user as any;
    return safe as User;
  }

  async findOrCreateSocial(data: {
    provider: string;
    providerId: string;
    email?: string;
    name?: string;
    profileImage?: string;
  }): Promise<User> {
    let user = await this.repo.findOne({
      where: { provider: data.provider, providerId: data.providerId },
    });
    if (!user && data.email) {
      user = await this.repo.findOne({ where: { email: data.email } });
    }
    if (user) {
      user.provider   = data.provider;
      user.providerId = data.providerId;
      if (data.name)         user.name         = data.name;
      if (data.profileImage) user.profileImage = data.profileImage;
      return this.repo.save(user);
    }
    const newUser = this.repo.create({
      provider:     data.provider,
      providerId:   data.providerId,
      email:        data.email,
      name:         data.name,
      profileImage: data.profileImage,
    });
    return this.repo.save(newUser);
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
  async updateAdminInfo(id: number, data: { name?: string; phone?: string; company?: string | null; logoUrl?: string | null; isExportOnly?: boolean }): Promise<User> {
    const user = await this.repo.findOneBy({ id });
    if (!user) throw new UnauthorizedException('유저를 찾을 수 없습니다.');
    if (data.name !== undefined) user.name = data.name;
    if (data.phone !== undefined) user.phone = data.phone;
    if (data.company !== undefined) user.company = data.company || null;
    if (data.logoUrl !== undefined) user.logoUrl = data.logoUrl || null;
    if (data.isExportOnly !== undefined) user.isExportOnly = data.isExportOnly;
    return this.repo.save(user);
  }

  async updateMarketingConsent(id: number, consent: boolean): Promise<User> {
    const user = await this.repo.findOneBy({ id });
    if (!user) throw new UnauthorizedException('유저를 찾을 수 없습니다.');
    user.marketingConsent = consent;
    return this.repo.save(user);
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
