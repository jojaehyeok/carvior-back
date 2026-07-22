import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientErrorLog } from './client-error-log.entity';

@Injectable()
export class ClientErrorLogsService {
  constructor(
    @InjectRepository(ClientErrorLog)
    private readonly repo: Repository<ClientErrorLog>,
  ) {}

  async create(data: { driverId?: string | null; driverName?: string | null; screen: string; message: string }) {
    const log = this.repo.create(data);
    return await this.repo.save(log);
  }

  async findRecent(limit = 50) {
    return await this.repo.find({ order: { createdAt: 'DESC' }, take: limit });
  }
}
