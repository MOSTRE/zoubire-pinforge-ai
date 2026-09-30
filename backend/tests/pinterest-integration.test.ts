/**
 * Pinterest integration test (spec v5.28.0).
 *
 * 1. Takes a completed Pin (product + generated 1000x1500 image) from the
 *    local SQLite DB (seeded by `npm run sync` + pin generation).
 * 2. Builds the EXACT `POST /v5/pins` payload via buildPinPayload and
 *    validates it against PinCreatePayloadSchema (local mirror of the
 *    official PinCreate schema).
 * 3. NEVER publishes unless ALL of the following are true:
 *      - PINTEREST_LIVE_PUBLISH=true
 *      - PINTEREST_CLIENT_ID/SECRET configured + a stored access token
 *      - PINTEREST_TEST_BOARD_ID set (numeric) — the test publishes there
 *    Otherwise it reports exactly what WOULD be sent (dry-run).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { prisma, getSetting } from '../src/db';
import { buildPinPayload, PinCreatePayloadSchema, createPin } from '../src/services/pinterest/client';
import { qualityCheck } from '../src/services/images/base';

const MAX_BASE64_BYTES = 18 * 1024 * 1024;

describe('pinterest integration (dry-run by default)', () => {
  it('builds a valid pins/create payload from a synced Gumroad product', async () => {
    const pin = await prisma.pin.findFirst({
      where: { imagePath: { not: null } },
      orderBy: { createdAt: 'desc' },
      include: { product: true },
    });
    expect(
      pin,
      'No completed Pin in DB — run `npm run sync` then generate a Pin in the app first.'
    ).toBeTruthy();
    if (!pin || !pin.product) return;

    // 1) source product is a real synced Gumroad product (never hardcoded)
    expect(pin.product.url).toMatch(/^https:\/\/zoubire\.gumroad\.com\/l\//);

    // 2) image exists and passes QC (1000x1500, ~2:3, readable)
    const qc = await qualityCheck(pin.imagePath as string);
    expect(qc.ok).toBe(true);
    const buf = fs.readFileSync(pin.imagePath as string);
    expect(buf.length).toBeGreaterThan(5000);
    expect(buf.length).toBeLessThanOrEqual(MAX_BASE64_BYTES);

    // 3) board: use the pin's board when numeric, else the test board override
    const boardId =
      pin.boardId && /^\d+$/.test(pin.boardId)
        ? pin.boardId
        : process.env.PINTEREST_TEST_BOARD_ID || '';
    const b64 = buf.toString('base64');
    const payload = buildPinPayload({
      boardId: boardId || '000000000000', // placeholder: validates shape; replaced before any live call
      title: pin.title,
      description: pin.description || '',
      link: pin.destinationUrl,
      imageBase64: b64,
      contentType: pin.imagePath!.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
      altText: pin.title,
    });

    // 4) local schema validation against the official PinCreate limits
    const parsed = PinCreatePayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);

    // 5) report exactly what would be sent (bulk base64 redacted, hashed)
    const hash = crypto.createHash('sha256').update(b64).digest('hex');
    const report = {
      method: 'POST',
      url: 'https://api.pinterest.com/v5/pins',
      headers: { Authorization: 'Bearer <access_token>', 'Content-Type': 'application/json' },
      body: {
        ...payload,
        media_source: {
          ...payload.media_source,
          data: `<base64 ${b64.length} chars, sha256 ${hash.slice(0, 16)}…>`,
        },
      },
      imageBytes: buf.length,
      base64Chars: b64.length,
    };
    console.log('[pinterest-integration] payload that would be sent:\n' + JSON.stringify(report, null, 2));

    // 6) live gate — publish ONLY with explicit opt-in credentials
    const livePublish = (process.env.PINTEREST_LIVE_PUBLISH || '').toLowerCase() === 'true';
    const token = await getSetting('PINTEREST_ACCESS_TOKEN', '');
    const hasClient = Boolean(process.env.PINTEREST_CLIENT_ID && process.env.PINTEREST_CLIENT_SECRET);
    const testBoard = process.env.PINTEREST_TEST_BOARD_ID || '';
    if (livePublish && hasClient && token && /^\d+$/.test(testBoard)) {
      const live = buildPinPayload({
        boardId: testBoard,
        title: pin.title,
        description: pin.description || '',
        link: pin.destinationUrl,
        imageBase64: b64,
        altText: pin.title,
      });
      const created = await createPin(live);
      console.log(`[pinterest-integration] LIVE publish succeeded: pin id ${created.id}`);
      expect(String(created.id || '')).toMatch(/\d+/);
    } else {
      const reasons: string[] = [];
      if (!livePublish) reasons.push('PINTEREST_LIVE_PUBLISH != true');
      if (!hasClient) reasons.push('PINTEREST_CLIENT_ID/SECRET missing');
      if (!token) reasons.push('no stored Pinterest access token (connect via OAuth first)');
      if (!/^\d+$/.test(testBoard)) reasons.push('PINTEREST_TEST_BOARD_ID not set to a numeric board id');
      console.log(`[pinterest-integration] DRY-RUN only — not publishing (${reasons.join('; ')})`);
    }

    await prisma.$disconnect();
  }, 120000);
});
