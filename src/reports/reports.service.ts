import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Report } from './entities/report.entity';
import { ChatRoom } from '../chat/entities/chat-room.entity';
import { StoreItem } from '../store-items/entities/store-item.entity';
import { User } from '../users/entities/user.entity';

const REASONS: Record<string, string> = {
  fake: '허위매물 의심',
  price: '가격이 올린 것과 다름',
  dealer: '개인인 척하는 딜러',
  fraud: '사기 의심(선입금 요구 등)',
  abuse: '욕설·협박',
  spam: '광고·도배',
  other: '기타',
};

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    @InjectRepository(ChatRoom) private readonly rooms: Repository<ChatRoom>,
    @InjectRepository(StoreItem) private readonly storeItems: Repository<StoreItem>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  static reasonLabel(code: string) {
    return REASONS[code] ?? code;
  }

  /**
   * 신고 접수. 같은 사람이 같은 대상을 다시 신고하면 새로 쌓지 않고 기존 접수건을 돌려준다
   * (화가 나서 여러 번 누르는 경우가 실제로 생긴다 — 관리자 화면이 같은 건으로 뒤덮이면 안 된다).
   */
  async create(
    reporterUserId: number,
    input: { targetType: 'listing' | 'chat'; targetId: number; reason: string; detail?: string },
  ) {
    const { targetType, reason } = input;
    const targetId = Number(input.targetId);
    if (targetType !== 'listing' && targetType !== 'chat') {
      throw new BadRequestException('신고 대상이 올바르지 않습니다.');
    }
    if (!REASONS[reason]) throw new BadRequestException('신고 사유를 선택해주세요.');
    const detail = (input.detail ?? '').trim().slice(0, 1000) || null;

    let storeItemId: number | null = null;
    let targetUserId: number | null = null;

    if (targetType === 'listing') {
      const item = await this.storeItems.findOne({ where: { id: targetId } });
      if (!item) throw new NotFoundException('매물을 찾을 수 없습니다.');
      storeItemId = item.id;
      targetUserId = item.userId ?? null;
    } else {
      const room = await this.rooms.findOne({ where: { id: targetId } });
      if (!room) throw new NotFoundException('대화방을 찾을 수 없습니다.');
      // 남의 대화를 신고할 수는 없다
      if (room.buyerUserId !== reporterUserId && room.sellerUserId !== reporterUserId) {
        throw new ForbiddenException('참여자만 신고할 수 있습니다.');
      }
      storeItemId = room.storeItemId;
      targetUserId = room.buyerUserId === reporterUserId ? room.sellerUserId : room.buyerUserId;
    }

    if (targetUserId === reporterUserId) {
      throw new BadRequestException('자기 자신은 신고할 수 없습니다.');
    }

    const existing = await this.reports.findOne({
      where: { reporterUserId, targetType, targetId, status: 'pending' },
    });
    if (existing) return { id: existing.id, duplicated: true };

    const saved = await this.reports.save(
      this.reports.create({ reporterUserId, targetType, targetId, storeItemId, targetUserId, reason, detail }),
    );
    return { id: saved.id, duplicated: false };
  }

  // 관리자 목록 — 신고자·대상자 이름과 매물 제목을 붙여서 한 화면에서 판단할 수 있게 한다
  async listForAdmin(status?: string) {
    const rows = await this.reports.find({
      where: status ? { status: status as Report['status'] } : {},
      order: { id: 'DESC' },
      take: 500,
    });
    if (rows.length === 0) return [];

    const userIds = [
      ...new Set(rows.flatMap((r) => [r.reporterUserId, r.targetUserId]).filter((v): v is number => !!v)),
    ];
    const itemIds = [...new Set(rows.map((r) => r.storeItemId).filter((v): v is number => !!v))];
    const users = userIds.length ? await this.users.find({ where: { id: In(userIds) } }) : [];
    const items = itemIds.length ? await this.storeItems.find({ where: { id: In(itemIds) } }) : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    const itemMap = new Map(items.map((i) => [i.id, i]));

    return rows.map((r) => {
      const reporter = userMap.get(r.reporterUserId);
      const target = r.targetUserId ? userMap.get(r.targetUserId) : null;
      const item = r.storeItemId ? itemMap.get(r.storeItemId) : null;
      return {
        ...r,
        reasonLabel: ReportsService.reasonLabel(r.reason),
        reporterName: reporter?.name ?? '#' + r.reporterUserId,
        reporterPhone: reporter?.phone ?? null,
        targetName: target?.name ?? null,
        targetPhone: target?.phone ?? null,
        storeItemTitle: item?.titleKo ?? null,
        storeItemStatus: item?.status ?? null,
      };
    });
  }

  countPending() {
    return this.reports.count({ where: { status: 'pending' } });
  }

  /**
   * 처리 — 조치(resolved)/문제없음(dismissed)을 남긴다.
   * hideListing이 true면 매물을 hidden으로 내린다(지우지 않는다 — 분쟁 때 기록이 필요하다).
   *
   * 신고가 들어왔다고 자동으로 내리지 않는 이유: 신고 한 건으로 매물이 사라지면
   * 경쟁 판매자가 신고만으로 남의 매물을 내릴 수 있다.
   */
  async handle(
    id: number,
    input: { status: 'resolved' | 'dismissed'; adminNote?: string; adminLogin?: string; hideListing?: boolean },
  ) {
    const report = await this.reports.findOne({ where: { id } });
    if (!report) throw new NotFoundException('신고를 찾을 수 없습니다.');
    if (input.status !== 'resolved' && input.status !== 'dismissed') {
      throw new BadRequestException('처리 상태가 올바르지 않습니다.');
    }

    if (input.hideListing && report.storeItemId) {
      const item = await this.storeItems.findOne({ where: { id: report.storeItemId } });
      if (item) {
        item.status = 'hidden';
        await this.storeItems.save(item);
      }
    }

    report.status = input.status;
    report.adminNote = (input.adminNote ?? '').trim() || null;
    report.handledBy = input.adminLogin ?? null;
    report.handledAt = new Date();
    await this.reports.save(report);
    return { ok: true };
  }
}
