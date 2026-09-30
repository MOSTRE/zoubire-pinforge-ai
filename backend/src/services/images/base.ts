import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '../../env';
import { logger } from '../../logger';

export interface ImageGenRequest {
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  workflow?: string;
}

export interface ImageGenResult {
  provider: string;
  outputPath: string;
  width: number;
  height: number;
  bytes: number;
  hash: string;
  jobId?: string;
}

export interface ImageProvider {
  name: string;
  status(): Promise<{ ok: boolean; detail?: string }>;
  generate(req: ImageGenRequest, destPath: string): Promise<ImageGenResult>;
}

export function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export async function qualityCheck(filePath: string, expectW = 1000, expectH = 1500): Promise<{ ok: boolean; width: number; height: number; bytes: number; issues: string[] }> {
  const issues: string[] = [];
  if (!fs.existsSync(filePath)) return { ok: false, width: 0, height: 0, bytes: 0, issues: ['file does not exist'] };
  const stat = fs.statSync(filePath);
  if (stat.size < 5000) issues.push('file suspiciously small (likely corrupt)');
  if (stat.size > 25 * 1024 * 1024) issues.push('file exceeds 25MB');
  try {
    const meta = await sharp(filePath).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    if (!w || !h) issues.push('could not read dimensions');
    const ratio = w && h ? w / h : 0;
    const expected = expectW / expectH;
    if (ratio && Math.abs(ratio - expected) / expected > 0.08) issues.push(`aspect ratio ${w}x${h} is not ~2:3`);
    if (!['jpeg', 'png', 'webp'].includes(meta.format || '')) issues.push(`unexpected format: ${meta.format}`);
    return { ok: issues.length === 0, width: w, height: h, bytes: stat.size, issues };
  } catch (e) {
    return { ok: false, width: 0, height: 0, bytes: stat.size, issues: [`unreadable image: ${String(e).slice(0, 200)}`] };
  }
}

export function paletteFor(prompt: string): { bg: [number, number, number]; accent: [number, number, number] } {
  const h = crypto.createHash('md5').update(prompt).digest('hex');
  const hue = parseInt(h.slice(0, 4), 16) % 360;
  // deterministic pastel-ish palette derived from hue
  const c = (o: number): [number, number, number] => {
    const r = Math.round(120 + 100 * Math.abs(Math.sin((hue + o) * Math.PI / 180)));
    const g = Math.round(110 + 90 * Math.abs(Math.sin((hue + o + 60) * Math.PI / 180)));
    const b = Math.round(130 + 100 * Math.abs(Math.sin((hue + o + 120) * Math.PI / 180)));
    return [r, g, b];
  };
  return { bg: c(0), accent: c(140) };
}

function rgb(t: [number, number, number], a = 1): string {
  return `rgba(${t[0]},${t[1]},${t[2]},${a})`;
}

/** Always-available provider: gradient scene + grain + shapes, rendered with Sharp/SVG. */
export const syntheticProvider: ImageProvider = {
  name: 'local-synthetic',
  async status() {
    return { ok: true, detail: 'Built-in Sharp renderer, always available' };
  },
  async generate(req, destPath) {
    const w = req.width || 1000;
    const h = req.height || 1500;
    const { bg, accent } = paletteFor(req.prompt);
    const seed = req.seed ?? Math.floor(Math.random() * 1e9);
    const circles = Array.from({ length: 5 }, (_, i) => {
      const cx = (seed * (i + 3) * 7919 + i * 331) % w;
      const cy = (seed * (i + 7) * 104729 + i * 977) % h;
      const r = 90 + ((seed >> (i * 3)) % 180);
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${rgb(accent, 0.18)}"/>`;
    }).join('');
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${rgb(bg, 1)}"/><stop offset="1" stop-color="${rgb(accent, 1)}"/>
      </linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      ${circles}
      <rect x="0" y="${Math.round(h * 0.55)}" width="${w}" height="${Math.round(h * 0.45)}" fill="rgba(0,0,0,0.22)"/>
    </svg>`;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const tmp = destPath + '.svg';
    fs.writeFileSync(tmp, svg);
    try {
      await sharp(tmp).resize(w, h).png({ quality: 90 }).toFile(destPath);
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
    const meta = await sharp(destPath).metadata();
    const bytes = fs.statSync(destPath).size;
    return { provider: 'local-synthetic', outputPath: destPath, width: meta.width || w, height: meta.height || h, bytes, hash: sha256File(destPath) };
  },
};
