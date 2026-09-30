import type { AiProvider } from './types';

/**
 * Deterministic local heuristic provider. Always available, no network.
 * Produces conservative, non-fabricated copy from real product data only.
 */
export const localHeuristicProvider: AiProvider = {
  name: 'local-heuristic',
  async generateText(prompt: string) {
    return { text: `Heuristic draft for: ${prompt.slice(0, 200)}`, provider: 'local-heuristic', model: 'heuristic-v1' };
  },
  async generateJson<T>(prompt: string, fallback: T) {
    void prompt;
    return { data: fallback, provider: 'local-heuristic', model: 'heuristic-v1', repaired: false };
  },
  async status() {
    return { ok: true, model: 'heuristic-v1', detail: 'Built-in fallback, always available' };
  },
  async listModels() {
    return ['heuristic-v1'];
  },
};
