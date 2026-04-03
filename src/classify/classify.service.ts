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

const PROMPT = `You are a car inspection photo classifier. Look at this photo and respond with ONLY one of these exact English words — nothing else, no explanation:

- wheel : tire, rim, wheel, alloy wheel (close-up of tire/rim)
- engine : engine bay, engine components, battery, oil cap, coolant reservoir
- undercarriage : car underside, suspension, axle, exhaust pipe viewed from below
- interior : car cabin, seats, dashboard, steering wheel, center console, door panel inside
- damage : visible dent, scratch, rust, cracked paint, body damage close-up
- extra : other accessories, sunroof, trunk interior, navigation screen, infotainment
- exterior : full car body, door, fender, bumper, hood, roof, quarter panel (outside)

Reply with ONLY the single English word.`;

@Injectable()
export class ClassifyService {
  private client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  async classifyPhoto(imageUrl: string): Promise<{ category: string; label: string }> {
    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: imageUrl } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });

    const rawText = (response.content[0] as any).text ?? '';
    const raw = rawText.trim().toLowerCase().replace(/[^a-z]/g, '');
    const category = Object.keys(CATEGORY_MAP).includes(raw) ? raw : 'extra';

    console.log(`[AI분류] raw="${rawText.trim()}" → category="${category}" (${CATEGORY_MAP[category]}) | url=${imageUrl.slice(-30)}`);

    return { category, label: CATEGORY_MAP[category] };
  }
}
