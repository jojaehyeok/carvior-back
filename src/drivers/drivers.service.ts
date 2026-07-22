import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
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

    const hashedPassword = await bcrypt.hash(driverInfo.password, 10);
    const newDriver = this.driverRepository.create({
      ...driverInfo,
      password: hashedPassword,
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

  // 로그인 검증용 — password는 select:false라 명시적으로 addSelect 해야 함
  async findByAccountId(accountId: string) {
    return await this.driverRepository
      .createQueryBuilder('driver')
      .addSelect('driver.password')
      .where('driver.accountId = :accountId', { accountId })
      .getOne();
  }

  // 로그인 시 비밀번호 검증 — 기존에 평문으로 저장돼있던 계정은 로그인 성공 시점에
  // 자동으로 bcrypt 해시로 전환해서 저장(마이그레이션 스크립트 없이 점진적으로 안전하게 전환)
  async verifyPassword(driver: Driver, plainPassword: string): Promise<boolean> {
    const isBcryptHash = driver.password?.startsWith('$2');
    if (isBcryptHash) {
      return bcrypt.compare(plainPassword, driver.password);
    }
    const matches = driver.password === plainPassword;
    if (matches) {
      const hashed = await bcrypt.hash(plainPassword, 10);
      await this.driverRepository.update(driver.id, { password: hashed });
    }
    return matches;
  }

  async findById(id: number) {
    const driver = await this.driverRepository.findOne({ where: { id } });
    if (!driver) throw new NotFoundException('진단사를 찾을 수 없습니다.');
    return driver;
  }

  async updateAvailability(id: number, data: {
    regions?: string[];
    availableDays?: number[];
    availableStartTime?: string;
    availableEndTime?: string;
    maxDailyBookings?: number;
    vehicleTypes?: string[];
  }) {
    const driver = await this.driverRepository.findOne({ where: { id } });
    if (!driver) throw new NotFoundException('진단사를 찾을 수 없습니다.');
    Object.assign(driver, data);
    return await this.driverRepository.save(driver);
  }

  async updateLocation(id: number, lat: number, lng: number) {
    await this.driverRepository.update(id, { lat, lng, lastSeenAt: new Date() });
    return { success: true };
  }

  // 진단사가 앱에서 직접 켜고 끄는 "활동중지" 스위치
  async setActiveStatus(id: number, isActive: boolean) {
    const driver = await this.driverRepository.findOne({ where: { id } });
    if (!driver) throw new NotFoundException('진단사를 찾을 수 없습니다.');
    driver.isActive = isActive;
    return await this.driverRepository.save(driver);
  }

  async findLocations() {
    return this.driverRepository.find({
      where: { status: 'APPROVED' },
      select: [
        'id', 'name', 'phone', 'lat', 'lng', 'lastSeenAt', 'regions',
        'availableDays', 'availableStartTime', 'availableEndTime', 'isActive',
      ],
    });
  }

  async savePushToken(id: number, pushToken: string) {
    console.log(`[PushToken] 저장 요청 → driverId: ${id}, token: ${pushToken?.slice(0, 30)}...`);
    await this.driverRepository.update(id, { pushToken });
    console.log(`[PushToken] DB 저장 완료 → driverId: ${id}`);
  }
}