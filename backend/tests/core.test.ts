import { describe, it, expect } from 'vitest';
import { SeoPackSchema, AnalysisSchema, PinUpdateSchema, safeJsonParse, slugify } from '../src/validation';
import { fingerprint, titleSimilarity } from '../src/services/images/design';
import { fallbackSeoForAngle } from '../src/services/ai/generate';
import { planDaySlots } from '../src/services/scheduler';
import { buildPinPayload, PinCreatePayloadSchema, parsePinterestError } from '../src/services/pinterest/client';
import { qualityCheck, sha256File } from '../src/services/images/base';
import { sanitizeCopy } from '../src/services/ai/types';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('AI JSON validation', () => {
  it('accepts a valid SEO pack', () => {
    const r = SeoPackSchema.safeParse({
      title: 'Small Bedroom Layout Ideas That Actually Work',
      description: 'Practical layout ideas for small bedrooms and gaming corners. A useful guide worth saving — tap through to learn more.',
      primaryKeyword: 'small bedroom layout',
      secondaryKeywords: ['gaming room setup', 'study corner'],
      creativeAngle: 'educational',
      boardSuggestion: 'Small Bedroom Ideas',
      imagePrompt: 'Premium vertical Pinterest visual, cozy small bedroom, daylight, negative space on top, no text, no watermarks.',
      cta: 'Learn more',
      hashtags: ['#SmallBedroom'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects keyword-stuffed / missing fields', () => {
    const r = SeoPackSchema.safeParse({ title: 'x', description: 'short' });
    expect(r.success).toBe(false);
  });

  it('extracts JSON from prose wrapper', () => {
    const v = safeJsonParse<{ a: number }>('Here you go: {"a": 1} thanks');
    expect(v?.a).toBe(1);
  });

  it('sanitizes banned income claims', () => {
    expect(sanitizeCopy('Get guaranteed income fast')).not.toMatch(/guaranteed income/i);
  });
});

describe('filenames + hashing', () => {
  it('slugifies product names safely', () => {
    expect(slugify('💍 THE HANDOVER — DIY Wedding Playbook')).toMatch(/^[a-z0-9-]+$/);
  });

  it('prevents path traversal in slug', () => {
    expect(slugify('../../etc/passwd')).not.toContain('..');
  });

  it('computes sha256 file hash', () => {
    const f = path.join(os.tmpdir(), `pinforge-test-${Date.now()}.txt`);
    fs.writeFileSync(f, 'hello pinforge');
    const h = sha256File(f);
    expect(h).toHaveLength(64);
    fs.unlinkSync(f);
  });

  it('quality check flags missing file', async () => {
    const r = await qualityCheck(path.join(os.tmpdir(), 'definitely-missing-pinforge.png'));
    expect(r.ok).toBe(false);
  });
});

describe('offline SEO fallback', () => {
  it('produces distinct copy per creative angle', () => {
    const p = { name: 'CLIENTFLOW Pro — The Freelancer Business Dashboard' };
    const a = fallbackSeoForAngle(p, 'checklist');
    const b = fallbackSeoForAngle(p, 'mistakes-to-avoid');
    expect(a.titleSuffix).not.toBe(b.titleSuffix);
    expect(a.description).not.toBe(b.description);
    expect(a.titleSuffix.length).toBeGreaterThan(3);
  });
  it('falls back to generic angle for unknown input', () => {
    const r = fallbackSeoForAngle({ name: 'X' }, 'nope');
    expect(r.titleSuffix).toMatch(/Ideas/);
  });
});

describe('duplicate detection', () => {
  it('fingerprint is stable and sensitive', () => {
    const a = fingerprint('Title A', 'Desc', 'https://x.com/l/a', 'hash1');
    const b = fingerprint('Title A', 'Desc', 'https://x.com/l/a', 'hash1');
    const c = fingerprint('Title B', 'Desc', 'https://x.com/l/a', 'hash1');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('title similarity detects near-duplicates', () => {
    expect(titleSimilarity('Small bedroom layout ideas for gamers', 'Small bedroom layout ideas for gaming setups')).toBeGreaterThan(0.5);
    expect(titleSimilarity('Wedding day handover playbook', 'Freelancer invoicing dashboard')).toBeLessThan(0.3);
  });
});

describe('pin validation', () => {
  it('accepts valid patch', () => {
    expect(PinUpdateSchema.safeParse({ title: 'Nice title', status: 'approved' }).success).toBe(true);
  });
  it('rejects bad status', () => {
    expect(PinUpdateSchema.safeParse({ status: 'nope' }).success).toBe(false);
  });
});

describe('scheduler', () => {
  it('spreads slots across the window', () => {
    const slots = planDaySlots(new Date('2026-01-05T00:00:00'), 5, '09:00', '21:00', 0);
    expect(slots).toHaveLength(5);
    for (let i = 1; i < slots.length; i++) expect(slots[i].getTime()).toBeGreaterThan(slots[i - 1].getTime());
    expect(slots[0].getHours()).toBe(9);
  });
  it('returns empty for invalid window', () => {
    expect(planDaySlots(new Date(), 5, '21:00', '09:00')).toEqual([]);
  });
});

describe('pinterest payload', () => {
  const b64 = Buffer.from('pinforge-test-image-bytes-'.repeat(8)).toString('base64');
  it('builds image_base64 payload per API format', () => {
    const p = buildPinPayload({ boardId: '123', title: 'T', description: 'D', link: 'https://zoubire.gumroad.com/l/x', imageBase64: b64 });
    expect(p.board_id).toBe('123');
    expect(p.media_source.source_type).toBe('image_base64');
    expect(p.media_source).toMatchObject({ content_type: 'image/jpeg', is_standard: true });
  });
  it('supports image/png content type for png bytes', () => {
    const p = buildPinPayload({ boardId: '123', title: 'T', description: 'D', link: 'https://x.com/a', imageBase64: b64, contentType: 'image/png' });
    expect(p.media_source).toMatchObject({ content_type: 'image/png' });
  });
  it('throws when board or image missing (API error handling)', () => {
    expect(() => buildPinPayload({ boardId: '', title: 'T', description: 'D', link: 'https://x.com', imageBase64: b64 })).toThrow(/numeric/);
    expect(() => buildPinPayload({ boardId: '1', title: 'T', description: 'D', link: 'https://x.com' })).toThrow();
  });
  it('rejects non-numeric board ids (spec pattern ^\\d+$)', () => {
    expect(() => buildPinPayload({ boardId: 'my-board', title: 'T', description: 'D', link: 'https://x.com', imageBase64: b64 })).toThrow(/numeric/);
  });
  it('rejects invalid destination URLs (spec: http(s) link)', () => {
    expect(() => buildPinPayload({ boardId: '123', title: 'T', description: 'D', link: 'not-a-url', imageBase64: b64 })).toThrow(/http/);
    expect(() => buildPinPayload({ boardId: '123', title: 'T', description: 'D', link: 'ftp://x.com/a', imageBase64: b64 })).toThrow(/http/);
  });
  it('truncates to spec field limits (title 100 / description 800)', () => {
    const p = buildPinPayload({ boardId: '123', title: 't'.repeat(150), description: 'd'.repeat(900), link: 'https://x.com', imageBase64: b64 });
    expect(p.title).toHaveLength(100);
    expect(p.description).toHaveLength(800);
    const r = PinCreatePayloadSchema.safeParse({
      board_id: '123', title: 'ok', description: 'd'.repeat(801),
      link: 'https://x.com', media_source: { source_type: 'image_base64', content_type: 'image/jpeg', data: b64 },
    });
    expect(r.success).toBe(false);
  });
  it('parses Pinterest {code,message} error bodies', () => {
    expect(parsePinterestError(400, JSON.stringify({ code: 22, message: 'Board not found.' }))).toContain('code 22');
    expect(parsePinterestError(500, 'not json{{{')).toContain('500');
  });
});
