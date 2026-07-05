import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

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
      user.provider = data.provider;
      user.providerId = data.providerId;
      if (data.name) user.name = data.name;
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

  async create(data: Partial<User>): Promise<User> {
    const user = this.repo.create(data);
    return this.repo.save(user);
  }

  async findAll(): Promise<User[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }
}
