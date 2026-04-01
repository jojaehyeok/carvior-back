import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Driver } from './entities/driver.entity';

@Injectable()
export class DriversService {
  constructor(
    @InjectRepository(Driver)
    private readonly driverRepository: Repository<Driver>,
  ) { }

  // 가입 신청 (생성)
  async create(driverInfo: any, licenseImageUrl?: string | null) {
    const existing = await this.driverRepository.findOne({ where: { accountId: driverInfo.accountId } });
    if (existing) throw new ConflictException('이미 존재하는 아이디입니다.');

    const newDriver = this.driverRepository.create({
      ...driverInfo,
      licenseImageUrl: licenseImageUrl ?? null,
      status: 'PENDING',
    });
    return await this.driverRepository.save(newDriver);
  }

  async findAll() {
    // 모든 진단사를 생성일 역순(최신순)으로 가져옵니다.
    return await this.driverRepository.find({
      order: { createdAt: 'DESC' }
    });
  }

  // 승인 상태 변경
  async updateStatus(id: string, status: 'APPROVED' | 'REJECTED') {
    const driver = await this.driverRepository.findOne({ where: { id: Number(id) } });
    if (!driver) throw new NotFoundException('진단사를 찾을 수 없습니다.');
    driver.status = status;
    return await this.driverRepository.save(driver);
  }

  // 로그인 검증용
  async findByAccountId(accountId: string) {
    return await this.driverRepository.findOne({ where: { accountId } });
  }
}