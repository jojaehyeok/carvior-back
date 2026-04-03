import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { ClassificationFeedback } from './classification-feedback.entity';

const CATEGORY_MAP: Record<string, string> = {
  exterior: '외관',
  interior: '실내',
  wheel: '휠',
  engine: '엔진룸',
  undercarriage: '하체',
  damage: '외판 데미지',
  extra: '기타',
};

const BASE_PROMPT = `You are a car inspection photo classifier. Look at this photo and respond with ONLY one of these exact English words — nothing else, no explanation:

- wheel : tire, rim, wheel, alloy wheel (close-up of tire/rim)
- engine : engine bay, engine components, battery, oil cap, coolant reservoir
- undercarriage : car underside, suspension, axle, exhaust pipe viewed from below
- interior : car cabin, seats, dashboard, steering wheel, center console, door panel inside
- damage : visible dent, scratch, rust, cracked paint, body damage close-up
- extra : other accessories, sunroof, trunk interior, navigation screen, infotainment
- exterior : full car body, door, fender, bumper, hood, roof, quarter panel (outside)`;

@Injectable()
export class ClassifyService {
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  constructor(
    @InjectRepository(ClassificationFeedback)
    private feedbackRepo: Repository<ClassificationFeedback>,
  ) {}

  async saveFeedback(imageUrl: string, aiCategory: string, correctCategory: string): Promise<void> {
    await this.feedbackRepo.save({ imageUrl, aiCategory, correctCategory });
    console.log(`[피드백] ${aiCategory} → ${correctCategory} 저장 (총 누적: 계속 학습 중)`);
  }

  private async buildPromptWithFeedback(): Promise<string> {
    // 최근 200건 피드백에서 혼동 패턴 분석
    const feedbacks = await this.feedbackRepo.find({
      order: { createdAt: 'DESC' },
      take: 200,
    });

    if (feedbacks.length === 0) return BASE_PROMPT + '\n\nReply with ONLY the single English word.';

    // 어떤 카테고리가 자주 틀렸는지 집계
    const confusions: Record<string, Record<string, number>> = {};
    for (const f of feedbacks) {
      if (f.aiCategory !== f.correctCategory) {
        if (!confusions[f.aiCategory]) confusions[f.aiCategory] = {};
        confusions[f.aiCategory][f.correctCategory] = (confusions[f.aiCategory][f.correctCategory] || 0) + 1;
      }
    }

    // 혼동 패턴을 프롬프트 힌트로 변환
    const hints: string[] = [];
    for (const [wrong, corrects] of Object.entries(confusions)) {
      for (const [correct, count] of Object.entries(corrects)) {
        if (count >= 2) {
          hints.push(`  ⚠️ "${wrong}" is often confused with "${correct}" — be careful (${count} past corrections)`);
        }
      }
    }

    const hintSection = hints.length > 0
      ? `\n\nLearned corrections from human feedback:\n${hints.join('\n')}`
      : '';

    return BASE_PROMPT + hintSection + '\n\nReply with ONLY the single English word.';
  }

  async classifyPhoto(imageUrl: string): Promise<{ category: string; label: string }> {
    const prompt = await this.buildPromptWithFeedback();

    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: imageUrl } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    const rawText = (response.content[0] as any).text ?? '';
    const raw = rawText.trim().toLowerCase().replace(/[^a-z]/g, '');
    const category = Object.keys(CATEGORY_MAP).includes(raw) ? raw : 'extra';

    console.log(`[AI분류] raw="${rawText.trim()}" → category="${category}" (${CATEGORY_MAP[category]}) | url=...${imageUrl.slice(-30)}`);

    return { category, label: CATEGORY_MAP[category] };
  }
}
