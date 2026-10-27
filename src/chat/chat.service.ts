import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Not, Repository } from 'typeorm';
import { ChatRoom } from './entities/chat-room.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { StoreItem } from '../store-items/entities/store-item.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatRoom) private readonly rooms: Repository<ChatRoom>,
    @InjectRepository(ChatMessage) private readonly messages: Repository<ChatMessage>,
    @InjectRepository(StoreItem) private readonly storeItems: Repository<StoreItem>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /**
   * 매물 문의하기 — 방이 있으면 그 방을, 없으면 새로 만들어 돌려준다.
   * 판매자가 자기 매물에 문의하는 건 막는다(혼자 대화하는 방이 생긴다).
   */
  async openRoom(storeItemId: number, buyerUserId: number): Promise<ChatRoom> {
    const item = await this.storeItems.findOne({ where: { id: storeItemId } });
    if (!item) throw new NotFoundException('매물을 찾을 수 없습니다.');
    if (item.listingType !== 'personal') {
      throw new BadRequestException('개인 직거래 매물에서만 문의할 수 있습니다.');
    }
    if (item.status !== 'active') {
      throw new BadRequestException('지금은 문의할 수 없는 매물입니다.');
    }

    const sellerUserId = item.userId;
    if (!sellerUserId) throw new BadRequestException('판매자 정보가 없는 매물입니다.');
    if (sellerUserId === buyerUserId) throw new BadRequestException('본인 매물에는 문의할 수 없습니다.');

    const existing = await this.rooms.findOne({ where: { storeItemId, buyerUserId } });
    if (existing) return existing;

    const room = await this.rooms.save(
      this.rooms.create({ storeItemId, buyerUserId, sellerUserId, status: 'active' }),
    );

    // 첫 방에는 안내를 한 줄 남긴다 — 빈 화면으로 시작하면 뭘 해야 할지 모른다.
    await this.messages.save(
      this.messages.create({
        roomId: room.id,
        senderUserId: 0,
        type: 'system',
        text: '대화가 시작되었습니다. 차량 상태가 궁금하시면 카비어 검차를 함께 이용해보세요.',
      }),
    );
    return room;
  }

  // 내가 낀 방 목록 — 매물 제목·사진과 안 읽은 개수를 같이 붙여서 목록 화면이 바로 그리게 한다
  async listRooms(userId: number) {
    const rows = await this.rooms.find({
      where: [{ buyerUserId: userId }, { sellerUserId: userId }],
      order: { lastMessageAt: 'DESC', id: 'DESC' },
    });
    if (rows.length === 0) return [];

    const items = await this.storeItems.find({ where: { id: In(rows.map((r) => r.storeItemId)) } });
    const itemMap = new Map(items.map((i) => [i.id, i]));

    const partnerIds = rows.map((r) => (r.buyerUserId === userId ? r.sellerUserId : r.buyerUserId));
    const partners = await this.users.find({ where: { id: In(partnerIds) } });
    const partnerMap = new Map(partners.map((u) => [u.id, u]));

    return Promise.all(
      rows.map(async (r) => {
        const isBuyer = r.buyerUserId === userId;
        const readAt = isBuyer ? r.buyerReadAt : r.sellerReadAt;
        // 안 읽은 개수 = 내가 마지막으로 읽은 시각 이후에 온 메시지 중 내가 보낸 게 아닌 것.
        // 한 번도 안 읽었으면(readAt 없음) 방 안의 상대 메시지 전부가 안 읽은 것이다.
        const unread = await this.messages.count({
          where: {
            roomId: r.id,
            senderUserId: Not(userId),
            ...(readAt ? { createdAt: MoreThan(readAt) } : {}),
          },
        });
        const item = itemMap.get(r.storeItemId);
        const partner = partnerMap.get(isBuyer ? r.sellerUserId : r.buyerUserId);
        return {
          id: r.id,
          storeItemId: r.storeItemId,
          title: item?.titleKo ?? '삭제된 매물',
          photo: (item?.photos as { exterior?: string[] } | null)?.exterior?.[0] ?? null,
          askingPrice: item?.askingPrice ?? null,
          partnerName: partner?.name ?? '상대방',
          role: isBuyer ? 'buyer' : 'seller',
          lastMessageText: r.lastMessageText,
          lastMessageAt: r.lastMessageAt,
          unread,
          status: r.status,
        };
      }),
    );
  }

  // 방 하나 열기 — 내가 낀 방이 아니면 못 본다(남의 대화를 주소만 바꿔서 보는 걸 막는다)
  async getRoom(roomId: number, userId: number) {
    const room = await this.rooms.findOne({ where: { id: roomId } });
    if (!room) throw new NotFoundException('대화방을 찾을 수 없습니다.');
    if (room.buyerUserId !== userId && room.sellerUserId !== userId) {
      throw new ForbiddenException('참여자만 볼 수 있는 대화입니다.');
    }
    const item = await this.storeItems.findOne({ where: { id: room.storeItemId } });
    return {
      ...room,
      item: item
        ? {
            id: item.id,
            titleKo: item.titleKo,
            askingPrice: item.askingPrice,
            photo: (item.photos as { exterior?: string[] } | null)?.exterior?.[0] ?? null,
            carHash: null,
          }
        : null,
      myRole: room.buyerUserId === userId ? 'buyer' : 'seller',
    };
  }

  async listMessages(roomId: number, userId: number) {
    await this.getRoom(roomId, userId); // 권한 확인
    return this.messages.find({ where: { roomId }, order: { id: 'ASC' }, take: 500 });
  }

  async sendMessage(roomId: number, senderUserId: number, text: string, type: 'text' | 'inspection' = 'text') {
    const room = await this.rooms.findOne({ where: { id: roomId } });
    if (!room) throw new NotFoundException('대화방을 찾을 수 없습니다.');
    if (room.buyerUserId !== senderUserId && room.sellerUserId !== senderUserId) {
      throw new ForbiddenException('참여자만 보낼 수 있습니다.');
    }
    if (room.status === 'blocked') throw new ForbiddenException('차단된 대화입니다.');

    const body = (text ?? '').trim();
    if (!body) throw new BadRequestException('내용이 비어 있습니다.');
    if (body.length > 1000) throw new BadRequestException('메시지가 너무 깁니다.');

    const saved = await this.messages.save(
      this.messages.create({ roomId, senderUserId, text: body, type }),
    );

    room.lastMessageAt = saved.createdAt;
    room.lastMessageText = body.slice(0, 120);
    // 보낸 사람 입장에선 방금 읽은 것과 같다
    if (room.buyerUserId === senderUserId) room.buyerReadAt = saved.createdAt;
    else room.sellerReadAt = saved.createdAt;
    await this.rooms.save(room);

    return saved;
  }

  async markRead(roomId: number, userId: number) {
    const room = await this.rooms.findOne({ where: { id: roomId } });
    if (!room) return;
    if (room.buyerUserId === userId) room.buyerReadAt = new Date();
    else if (room.sellerUserId === userId) room.sellerReadAt = new Date();
    else return;
    await this.rooms.save(room);
  }
}
