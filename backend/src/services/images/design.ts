import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export type DesignTemplate =
  | 'headline-hero'
  | 'minimal-ad'
  | 'checklist'
  | 'problem-solution'
  | 'tutorial'
  | 'before-after'
  | 'bold-type';

export interface DesignOptions {
  template: DesignTemplate | string;
  headline: string;
  subtitle?: string;
  cta?: string;
  brandName?: string;
  footer?: string;
  textPosition?: 'top' | 'center' | 'bottom';
  accent?: string;
  fontScale?: number;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) {
      if (cur) lines.push(cur.trim());
      cur = w;
    } else cur += ' ' + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.slice(0, 6);
}

function textSvg(opts: DesignOptions, w: number, h: number): string {
  const headline = opts.headline.slice(0, 140) || 'New ideas';
  const subtitle = (opts.subtitle || '').slice(0, 220);
  const cta = (opts.cta || '').slice(0, 80);
  const brand = (opts.brandName || '').slice(0, 60);
  const footer = (opts.footer || '').slice(0, 100);
  const accent = opts.accent || '#ff90e8';
  const scale = opts.fontScale || 1;
  const pos = opts.textPosition || 'top';
  const headLines = wrap(headline, 22);
  const headSize = Math.round(64 * scale);
  const subSize = Math.round(30 * scale);
  const lineH = Math.round(headSize * 1.12);
  const startY = pos === 'top' ? 150 : pos === 'center' ? Math.round(h * 0.34) : Math.round(h * 0.58);
  const headSvg = headLines
    .map((l, i) => `<text x="80" y="${startY + i * lineH}" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="${headSize}" fill="#ffffff" stroke="rgba(0,0,0,0.55)" stroke-width="1.5" paint-order="stroke">${esc(l)}</text>`)
    .join('');
  const subSvg = subtitle
    ? wrap(subtitle, 40).slice(0, 3).map((l, i) => `<text x="80" y="${startY + headLines.length * lineH + 40 + i * 40}" font-family="Arial,Helvetica,sans-serif" font-size="${subSize}" fill="#f5f5f5" stroke="rgba(0,0,0,0.5)" stroke-width="1" paint-order="stroke">${esc(l)}</text>`).join('')
    : '';
  const badge = cta
    ? `<g><rect x="80" y="${h - 260}" rx="28" width="${Math.min(560, 200 + cta.length * 14)}" height="72" fill="${accent}"/><text x="110" y="${h - 212}" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="34" fill="#111">${esc(cta)}</text></g>`
    : '';
  const brandSvg = brand ? `<text x="80" y="${h - 120}" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="30" fill="#ffffff" opacity="0.95" stroke="rgba(0,0,0,0.5)" stroke-width="1" paint-order="stroke">${esc(brand)}</text>` : '';
  const footerSvg = footer ? `<text x="80" y="${h - 80}" font-family="Arial,Helvetica,sans-serif" font-size="24" fill="#eeeeee" opacity="0.9">${esc(footer)}</text>` : '';
  const scrimH = Math.min(h, startY + headLines.length * lineH + (subtitle ? 160 : 60) + 80);
  const scrimY = Math.max(0, startY - 110);
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="rgba(0,0,0,0.62)"/><stop offset="1" stop-color="rgba(0,0,0,0.05)"/>
    </linearGradient></defs>
    <rect x="0" y="${scrimY}" width="${w}" height="${scrimH - scrimY + 40}" fill="url(#scrim)"/>
    <rect x="80" y="${Math.max(60, startY - 90)}" width="120" height="12" fill="${accent}"/>
    ${headSvg}${subSvg}${badge}${brandSvg}${footerSvg}
  </svg>`;
}

/** Compose final Pinterest artwork: base image + typography overlay via Sharp. No AI text needed. */
export async function composePinImage(basePath: string, outPath: string, opts: DesignOptions, w = 1000, h = 1500): Promise<{ path: string; width: number; height: number; bytes: number }> {
  const overlay = Buffer.from(textSvg(opts, w, h));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // normalize base to 1000x1500 cover, then composite overlay
  await sharp(basePath).resize(w, h, { fit: 'cover', position: 'center' }).png().toBuffer()
    .then((bg) => sharp(bg).composite([{ input: overlay, top: 0, left: 0 }]).jpeg({ quality: 90 }).toFile(outPath));
  const meta = await sharp(outPath).metadata();
  const bytes = fs.statSync(outPath).size;
  return { path: outPath, width: meta.width || w, height: meta.height || h, bytes };
}

export function fingerprint(title: string, description: string, destinationUrl: string, imageHash?: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update([norm(title), norm(description).slice(0, 500), norm(destinationUrl), imageHash || ''].join('|')).digest('hex');
}

export function titleSimilarity(a: string, b: string): number {
  const sa = new Set(a.toLowerCase().split(/\W+/).filter((x) => x.length > 2));
  const sb = new Set(b.toLowerCase().split(/\W+/).filter((x) => x.length > 2));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / Math.max(sa.size, sb.size);
}
