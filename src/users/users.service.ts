import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
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
    dealerLicenseUrl?: string;
    businessRegUrl?: string;
    businessNumber?: string;
    companyName?: string;
  }): Promise<User> {
    const existing = await this.findByEmail(data.email);
    if (existing) throw new ConflictException('이미 사용 중인 이메일입니다.');

    const hashed = await bcrypt.hash(data.password, 10);
    const isDealer = data.role === 'dealer';
    const user = this.repo.create({
      email:            data.email,
      password:         hashed,
      name:             data.name,
      phone:            data.phone,
      role:             data.role ?? 'user',
      provider:         'local',
      dealerLicenseUrl: data.dealerLicenseUrl,
      businessRegUrl:   data.businessRegUrl,
      businessNumber:   data.businessNumber,
      companyName:      data.companyName,
      dealerStatus:     isDealer ? 'pending' : 'none',
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

  async findAdmins(): Promise<User[]> {
    return this.repo.find({ where: { role: 'admin' }, order: { createdAt: 'DESC' } });
  }
}
