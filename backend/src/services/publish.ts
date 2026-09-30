import fs from 'node:fs';
import sharp from 'sharp';
import { prisma, recordActivity } from '../db';
import { logger } from '../logger';
import { buildPinPayload, createPin } from './pinterest/client';
import { checkDuplicate, publishingAllowed } from './safety';

export async function publishPin(pinId: string, opts: { force?: boolean } = {}): Promise<{ pinterestPinId: string }> {
  const pin = await prisma.pin.findUnique({ where: { id: pinId } });
  if (!pin) throw Object.assign(new Error('Pin not found'), { statusCode: 404 });
  if (!pin.boardId) throw Object.assign(new Error('Pin has no board — select a board first'), { statusCode: 400 });
  if (!pin.imagePath || !fs.existsSync(pin.imagePath)) {
    throw Object.assign(new Error('Pin image missing — regenerate the image first'), { statusCode: 400 });
  }
  const dup = await checkDuplicate(pinId);
  if (dup.duplicate && !opts.force) {
    throw Object.assign(new Error(`Potential duplicate detected: ${dup.reasons.join('; ')}`), { statusCode: 409, duplicate: dup });
  }
  if (!opts.force) {
    const gate = await publishingAllowed();
    if (!gate.allowed) throw Object.assign(new Error(gate.reason || 'Publishing not allowed right now'), { statusCode: 429 });
  }
  if ((process.env.PUBLISHING_MODE || 'manual').toLowerCase() !== 'auto' && !opts.force) {
    // manual mode still allows explicit publish clicks; scheduled auto jobs pass force=true
    void 0;
  }

  await prisma.pin.update({ where: { id: pinId }, data: { status: 'publishing', publishError: null } });
  try {
    const buf = fs.readFileSync(pin.imagePath);
    if (buf.length > 18 * 1024 * 1024) throw new Error('Image too large for Pinterest upload (>18MB)');
    // content_type must match the actual bytes (spec enum: image/jpeg | image/png)
    let contentType: 'image/jpeg' | 'image/png' = 'image/jpeg';
    try {
      const meta = await sharp(pin.imagePath).metadata();
      contentType = meta.format === 'png' ? 'image/png' : 'image/jpeg';
    } catch {
      contentType = pin.imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    }
    const payload = buildPinPayload({
      boardId: pin.boardId,
      title: pin.title,
      description: pin.description || '',
      link: pin.destinationUrl,
      imageBase64: buf.toString('base64'),
      contentType,
      altText: pin.title,
    });
    // retry once on 429/5xx with backoff
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const created = await createPin(payload);
        const pid = String(created.id || '');
        await prisma.pin.update({
          where: { id: pinId },
          data: { status: 'published', pinterestPinId: pid, publishedAt: new Date(), publishError: null },
        });
        await recordActivity('publish', `Published "${pin.title.slice(0, 80)}"`, { pinId, pinterestPinId: pid });
        logger.info(`Pin published: ${pinId} -> ${pid}`);
        return { pinterestPinId: pid };
      } catch (e) {
        lastErr = e;
        const sc = (e as { statusCode?: number }).statusCode || 0;
        if (sc === 429 || (sc >= 500 && sc < 600)) {
          // Honor Pinterest's Retry-After hint on 429 (capped at 5 min), else linear backoff.
          const hint = sc === 429 ? Number((e as { retryAfterSec?: number }).retryAfterSec || 0) : 0;
          const waitMs = hint > 0 ? Math.min(hint, 300) * 1000 : 2000 * (attempt + 1);
          logger.warn(`Publish attempt ${attempt + 1} got ${sc}, retrying in ${Math.round(waitMs / 1000)}s`, { pinId });
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Publish failed after retries');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.pin.update({ where: { id: pinId }, data: { status: 'failed', publishError: msg.slice(0, 1000) } });
    await recordActivity('error', `Publish failed for "${pin.title.slice(0, 80)}": ${msg.slice(0, 200)}`, { pinId });
    throw e;
  }
}
