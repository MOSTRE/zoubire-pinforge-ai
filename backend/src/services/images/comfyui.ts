import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../env';
import { logger } from '../../logger';
import type { ImageProvider, ImageGenRequest, ImageGenResult } from './base';
import { sha256File } from './base';

interface ComfySubmit { prompt_id: string; number?: number; node_errors?: unknown }

function comfyBase(): string {
  return (process.env.COMFYUI_URL || env.COMFYUI_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
}

export function loadWorkflow(name: string): { workflow: Record<string, unknown>; negative: string; positive_suffix: string } {
  const file = path.join(env.CONFIG_DIR, 'comfyui', `${name}.json`);
  const fallback = path.join(env.CONFIG_DIR, 'comfyui', 'default.json');
  const target = fs.existsSync(file) ? file : fallback;
  const raw = JSON.parse(fs.readFileSync(target, 'utf-8')) as {
    workflow?: Record<string, unknown>;
    negative?: string;
    positive_suffix?: string;
  } & Record<string, unknown>;
  // support both {workflow:{...}} and raw workflow JSON
  const workflow = (raw.workflow || raw) as Record<string, unknown>;
  return { workflow, negative: String(raw.negative || ''), positive_suffix: String(raw.positive_suffix || '') };
}

function applyTemplate(workflow: Record<string, unknown>, positive: string, negative: string, w: number, h: number, seed: number): Record<string, unknown> {
  const s = JSON.stringify(workflow)
    .replaceAll('{{POSITIVE}}', positive.replace(/"/g, "'"))
    .replaceAll('{{NEGATIVE}}', negative.replace(/"/g, "'"))
    .replaceAll('{{WIDTH}}', String(w))
    .replaceAll('"{{SEED}}"', String(seed))
    .replaceAll('{{SEED}}', String(seed))
    .replaceAll('{{HEIGHT}}', String(h));
  return JSON.parse(s) as Record<string, unknown>;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms); });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(t!);
  }
}

export const comfyProvider: ImageProvider = {
  name: 'comfyui',
  async status() {
    try {
      const res = await withTimeout(fetch(`${comfyBase()}/system_stats`), 6000, 'ComfyUI status');
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      return { ok: true, detail: `Connected at ${comfyBase()}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  },
  async generate(req: ImageGenRequest, destPath: string): Promise<ImageGenResult> {
    const w = req.width || 1000;
    const h = req.height || 1500;
    const seed = req.seed ?? Math.floor(Math.random() * 1e9);
    const { workflow, negative, positive_suffix } = loadWorkflow(req.workflow || process.env.COMFYUI_WORKFLOW || 'default');
    const positive = `${req.prompt} ${positive_suffix}`.slice(0, 2000);
    const prompt = applyTemplate(workflow, positive, negative, w, h, seed);

    const sub = await withTimeout(fetch(`${comfyBase()}/prompt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }),
    }), 30000, 'ComfyUI submit');
    if (!sub.ok) throw new Error(`ComfyUI submit failed: HTTP ${sub.status} ${(await sub.text()).slice(0, 400)}`);
    const data = (await sub.json()) as ComfySubmit;
    const promptId = data.prompt_id;
    if (!promptId) throw new Error('ComfyUI did not return a prompt_id');

    // poll history
    const deadline = Date.now() + 1000 * 60 * 10;
    let images: Array<{ filename: string; subfolder: string; type: string }> = [];
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const hist = await withTimeout(fetch(`${comfyBase()}/history/${promptId}`), 15000, 'ComfyUI history');
      if (!hist.ok) continue;
      const hj = (await hist.json()) as Record<string, { outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }> }>;
      const entry = hj[promptId];
      if (!entry?.outputs) continue;
      for (const node of Object.values(entry.outputs)) {
        if (node.images?.length) images.push(...node.images);
      }
      if (images.length) break;
      // check queue for failure
      try {
        const q = await withTimeout(fetch(`${comfyBase()}/queue`), 10000, 'ComfyUI queue');
        if (q.ok) {
          const qj = (await q.json()) as { queue_running?: unknown[]; queue_pending?: unknown[] };
          void qj;
        }
      } catch { /* ignore */ }
    }
    if (!images.length) throw new Error('ComfyUI generation timed out (no images after 10 min)');
    const img = images[0];
    const url = `${comfyBase()}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`;
    const dl = await withTimeout(fetch(url), 60000, 'ComfyUI download');
    if (!dl.ok) throw new Error(`ComfyUI download failed: HTTP ${dl.status}`);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const buf = Buffer.from(await dl.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    const sharp = (await import('sharp')).default;
    const meta = await sharp(destPath).metadata();
    const bytes = fs.statSync(destPath).size;
    logger.info(`ComfyUI image saved: ${destPath}`);
    return { provider: 'comfyui', outputPath: destPath, width: meta.width || w, height: meta.height || h, bytes, hash: sha256File(destPath), jobId: promptId };
  },
};
