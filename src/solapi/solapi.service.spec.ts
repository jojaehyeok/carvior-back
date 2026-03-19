import { Test, TestingModule } from '@nestjs/testing';
import { SolapiService } from './solapi.service';

describe('SolapiService', () => {
  let service: SolapiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SolapiService],
    }).compile();

    service = module.get<SolapiService>(SolapiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
