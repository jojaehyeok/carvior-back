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
  extra: '옵션',
  dashboard: '계기판',
  registration: '자동차등록증',
  vin: '보험이력',
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
  private classifyApiUrl = process.env.CLASSIFY_API_URL || null; // 예: http://localhost:8001

  constructor(
    @InjectRepository(ClassificationFeedback)
    private feedbackRepo: Repository<ClassificationFeedback>,
  ) {
    if (this.classifyApiUrl) {
      console.log(`[Classify] FastAPI 모드: ${this.classifyApiUrl}`);
    } else {
      console.log(`[Classify] Claude Haiku 모드`);
    }
  }

  async saveFeedback(imageUrl: string, aiCategory: string, correctCategory: string): Promise<void> {
    await this.feedbackRepo.save({ imageUrl, aiCategory, correctCategory });
    console.log(`[피드백] ${aiCategory} → ${correctCategory} 저장`);

    // FastAPI 서버에도 피드백 전달 (있을 때)
    if (this.classifyApiUrl) {
      try {
        const form = new URLSearchParams();
        form.append('image_url', imageUrl);
        form.append('ai_category', aiCategory);
        form.append('correct_category', correctCategory);
        await fetch(`${this.classifyApiUrl}/feedback`, {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(5000),
        });
        console.log(`[피드백→FastAPI] 전달 완료`);
      } catch (e) {
        console.warn(`[피드백→FastAPI] 전달 실패 (무시):`, (e as Error).message);
      }
    }
  }

  async classifyPhoto(imageUrl: string): Promise<{ category: string; label: string }> {
    // FastAPI 서버 우선 사용
    if (this.classifyApiUrl) {
      return this.classifyViaFastAPI(imageUrl);
    }
    return this.classifyViaClaude(imageUrl);
  }

  private async classifyViaFastAPI(imageUrl: string): Promise<{ category: string; label: string }> {
    try {
      const form = new URLSearchParams();
      form.append('url', imageUrl);
      const res = await fetch(`${this.classifyApiUrl}/classify`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json() as any;
      const { category, label, confidence, model_version } = data;
      console.log(`[FastAPI분류] category="${category}" confidence=${confidence} version=${model_version} | ...${imageUrl.slice(-30)}`);
      return { category, label: label || CATEGORY_MAP[category] || category };
    } catch (e) {
      console.warn(`[FastAPI분류] 실패, Claude로 fallback:`, (e as Error).message);
      return this.classifyViaClaude(imageUrl);
    }
  }

  private async classifyViaClaude(imageUrl: string): Promise<{ category: string; label: string }> {
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

    console.log(`[Claude분류] raw="${rawText.trim()}" → category="${category}" | ...${imageUrl.slice(-30)}`);
    return { category, label: CATEGORY_MAP[category] };
  }

  private async buildPromptWithFeedback(): Promise<string> {
    const feedbacks = await this.feedbackRepo.find({
      order: { createdAt: 'DESC' },
      take: 200,
    });

    if (feedbacks.length === 0) return BASE_PROMPT + '\n\nReply with ONLY the single English word.';

    const confusions: Record<string, Record<string, number>> = {};
    for (const f of feedbacks) {
      if (f.aiCategory !== f.correctCategory) {
        if (!confusions[f.aiCategory]) confusions[f.aiCategory] = {};
        confusions[f.aiCategory][f.correctCategory] = (confusions[f.aiCategory][f.correctCategory] || 0) + 1;
      }
    }

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
}
