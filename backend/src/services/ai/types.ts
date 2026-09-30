export interface AiProvider {
  name: string;
  generateJson<T>(prompt: string, fallback: T): Promise<{ data: T; provider: string; model: string; repaired: boolean }>;
  generateText(prompt: string): Promise<{ text: string; provider: string; model: string }>;
  status(): Promise<{ ok: boolean; model: string; detail?: string }>;
  listModels(): Promise<string[]>;
}

export const BANNED_CLAIMS = [
  'guaranteed income',
  'guaranteed sales',
  'guaranteed transformation',
  'guaranteed results',
  'get rich',
  'make $',
  'testimonial',
];

export function sanitizeCopy(text: string): string {
  let out = text;
  for (const b of BANNED_CLAIMS) {
    const re = new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, 'steady progress');
  }
  return out;
}
