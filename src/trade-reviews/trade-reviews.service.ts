import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TradeReview } from './entities/trade-review.entity';
import { ChatRoom } from '../chat/entities/chat-room.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class TradeReviewsService {
  constructor(
    @InjectRepository(TradeReview) private readonly reviews: Repository<TradeReview>,
    @InjectRepository(ChatRoom) private readonly rooms: Repository<ChatRoom>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  // 거래완료된 방에서만, 참여자가, 한 번만
  async create(roomId: number, reviewerUserId: number, input: { rating: number; text?: string }) {
    const room = await this.rooms.findOne({ where: { id: roomId } });
    if (!room) throw new NotFoundException('대화방을 찾을 수 없습니다.');
    if (room.buyerUserId !== reviewerUserId && room.sellerUserId !== reviewerUserId) {
      throw new ForbiddenException('참여자만 후기를 남길 수 있습니다.');
    }
    // 판매자가 다른 사람과 거래해서 같이 닫힌 방(sold_elsewhere)은 후기 대상이 아니다
    if (room.status !== 'closed' || room.closedReason !== 'completed') {
      throw new BadRequestException('거래완료된 거래에만 후기를 남길 수 있습니다.');
    }

    const rating = Math.round(Number(input.rating));
    if (!(rating >= 1 && rating <= 5)) throw new BadRequestException('별점은 1~5 사이로 선택해주세요.');

    const already = await this.reviews.findOne({ where: { roomId, reviewerUserId } });
    if (already) throw new BadRequestException('이미 후기를 남기셨습니다.');

    const targetUserId = room.buyerUserId === reviewerUserId ? room.sellerUserId : room.buyerUserId;
    const saved = await this.reviews.save(
      this.reviews.create({
        roomId,
        storeItemId: room.storeItemId,
        reviewerUserId,
        targetUserId,
        rating,
        text: (input.text ?? '').trim().slice(0, 300) || null,
      }),
    );
    return saved;
  }

  // 방 화면에서 쓰는 것 — 내가 썼는지, 상대가 나한테 뭘 남겼는지
  async forRoom(roomId: number, userId: number) {
    const rows = await this.reviews.find({ where: { roomId } });
    return {
      mine: rows.find((r) => r.reviewerUserId === userId) ?? null,
      received: rows.find((r) => r.targetUserId === userId) ?? null,
    };
  }

  // 판매자 평점 — 매물 상세에 붙인다
  async summaryFor(userId: number) {
    const rows = await this.reviews.find({ where: { targetUserId: userId } });
    if (rows.length === 0) return { count: 0, average: null as number | null };
    const sum = rows.reduce((acc, r) => acc + Number(r.rating), 0);
    return { count: rows.length, average: Math.round((sum / rows.length) * 10) / 10 };
  }

  // 한 사람이 받은 후기 목록(매물 상세에서 "판매자 후기 보기")
  async listFor(userId: number) {
    const rows = await this.reviews.find({ where: { targetUserId: userId }, order: { id: 'DESC' }, take: 20 });
    if (rows.length === 0) return [];
    const writers = await this.users.find({ where: { id: In(rows.map((r) => r.reviewerUserId)) } });
    const nameMap = new Map(writers.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      text: r.text,
      createdAt: r.createdAt,
      // 개인 거래라 실명을 다 보여주지 않는다 — 첫 글자만
      writerName: (nameMap.get(r.reviewerUserId) ?? '이용자').slice(0, 1) + '**',
    }));
  }
}
