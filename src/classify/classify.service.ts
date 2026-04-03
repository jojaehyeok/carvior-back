import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

const CATEGORY_MAP: Record<string, string> = {
  exterior: '외관',
  interior: '실내',
  wheel: '휠',
  engine: '엔진룸',
  undercarriage: '하체',
  damage: '외판 데미지',
  extra: '기타',
};

@Injectable()
export class ClassifyService {
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  async classifyPhoto(imageUrl: string): Promise<{ category: string; label: string }> {
    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: imageUrl } },
            {
              type: 'text',
              text: `이 차량 사진 카테고리를 영어 키만 답해:
exterior(외관/차체/도어/범퍼/후드/트렁크)
interior(실내/시트/대시보드/핸들)
wheel(타이어/휠/림)
engine(엔진룸/배터리/오일)
undercarriage(하체/서스펜션)
damage(외판 손상/긁힘/찌그러짐)
extra(기타)`,
            },
          ],
        },
      ],
    });

    const raw = ((response.content[0] as any).text ?? '').trim().toLowerCase();
    const category = Object.keys(CATEGORY_MAP).includes(raw) ? raw : 'extra';
    return { category, label: CATEGORY_MAP[category] };
  }
}
