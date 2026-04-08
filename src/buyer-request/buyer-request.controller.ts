import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { BuyerRequestService } from './buyer-request.service';
import { CreateBuyerRequestDto } from './dto/create-buyer-request.dto';
import { BuyerRequest } from './entities/buyer-request.entity';

@Controller('v1/external/buyer-request')
export class BuyerRequestController {
  constructor(private readonly service: BuyerRequestService) {}

  /**
   * POST /api/v1/external/buyer-request
   * 구매자 대행 서비스 신청 접수
   */
  @Post()
  async create(@Body() dto: CreateBuyerRequestDto) {
    const result = await this.service.create(dto);
    return {
      success: true,
      message: '접수가 완료되었습니다.',
      data: result,
    };
  }

  /**
   * GET /api/v1/external/buyer-request/list?source=KARROT_FORM
   * 전체 목록 조회 (관리자용)
   */
  @Get('list')
  async getList(@Query('source') source?: string) {
    return this.service.findAll(source);
  }

  /**
   * GET /api/v1/external/buyer-request/:id
   * 단건 조회
   */
  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.service.findOne(Number(id));
  }

  /**
   * PATCH /api/v1/external/buyer-request/:id/status
   * 상태 업데이트 (관리자: CONSULTING / COMPLETED / CANCELLED 등)
   */
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() updateData: Partial<BuyerRequest>,
  ) {
    const result = await this.service.updateStatus(Number(id), updateData);
    return {
      success: true,
      message: '상태가 업데이트되었습니다.',
      data: result,
    };
  }

  /**
   * PATCH /api/v1/external/buyer-request/:id/assign
   * 진단사 배정
   */
  @Patch(':id/assign')
  async assign(
    @Param('id') id: string,
    @Body() driverInfo: { id: string; name: string },
  ) {
    const result = await this.service.assign(Number(id), driverInfo);
    return {
      success: true,
      message: '진단사가 배정되었습니다.',
      data: result,
    };
  }
}
