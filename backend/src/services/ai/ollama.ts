import { logger } from '../../logger';
import type { AiProvider } from './types';

function baseUrl(): string {
  return (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
}
function model(): string {
  return process.env.OLLAMA_MODEL || 'llama3.1';
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`Ollama timeout after ${ms}ms`)), ms); });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(t!);
  }
}

export const ollamaProvider: AiProvider = {
  name: 'ollama',
  async generateText(prompt: string) {
    const res = await withTimeout(fetch(`${baseUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model(), prompt, stream: false, options: { temperature: 0.7 } }),
    }), 120000);
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const json = (await res.json()) as { response?: string };
    return { text: json.response || '', provider: 'ollama', model: model() };
  },
  async generateJson<T>(prompt: string, _fallback: T) {
    const sys = prompt + '\n\nIMPORTANT: Reply with ONLY valid JSON. No markdown fences, no prose.';
    const { text } = await this.generateText(sys);
    const cleaned = text.replace(/```json|```/g, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Ollama returned no JSON object');
    try {
      const data = JSON.parse(m[0]) as T;
      return { data, provider: 'ollama', model: model(), repaired: text !== m[0] };
    } catch (e) {
      logger.warn('Ollama JSON parse failed', { output: text.slice(0, 500) });
      throw new Error(`Ollama returned malformed JSON: ${String(e).slice(0, 200)}`);
    }
  },
  async status() {
    try {
      const res = await withTimeout(fetch(`${baseUrl()}/api/tags`), 8000);
      if (!res.ok) return { ok: false, model: model(), detail: `HTTP ${res.status}` };
      const json = (await res.json()) as { models?: Array<{ name?: string }> };
      const names = (json.models || []).map((m) => m.name || '');
      if (model() && names.length && !names.some((n) => n.startsWith(model()) || n === model())) {
        return { ok: true, model: model(), detail: `Connected, but model "${model()}" not found. Available: ${names.slice(0, 5).join(', ') || 'none'}` };
      }
      return { ok: true, model: model(), detail: names.length ? `Models: ${names.slice(0, 5).join(', ')}` : 'Connected' };
    } catch (e) {
      return { ok: false, model: model(), detail: e instanceof Error ? e.message : String(e) };
    }
  },
  async listModels() {
    try {
      const res = await withTimeout(fetch(`${baseUrl()}/api/tags`), 8000);
      if (!res.ok) return [];
      const json = (await res.json()) as { models?: Array<{ name?: string }> };
      return (json.models || []).map((m) => m.name || '').filter(Boolean);
    } catch {
      return [];
    }
  },
};
