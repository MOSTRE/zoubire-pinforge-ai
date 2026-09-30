import { prisma } from '../db';
import { titleSimilarity } from './images/design';

export interface DuplicateInfo {
  duplicate: boolean;
  reasons: string[];
  conflictingPinId?: string;
}

/** Refuse to publish same image+title+destination twice; warn on near-duplicates. */
export async function checkDuplicate(pinId: string): Promise<DuplicateInfo> {
  const pin = await prisma.pin.findUnique({ where: { id: pinId } });
  if (!pin) throw new Error('Pin not found');
  const reasons: string[] = [];

  // exact fingerprint match against published/publishing pins
  if (pin.contentFingerprint) {
    const exact = await prisma.pin.findFirst({
      where: {
        id: { not: pinId },
        contentFingerprint: pin.contentFingerprint,
        status: { in: ['published', 'publishing', 'scheduled', 'approved'] },
      },
    });
    if (exact) {
      return { duplicate: true, reasons: ['Exact duplicate: same image + title + destination already queued/published'], conflictingPinId: exact.id };
    }
  }

  // same image hash published before
  if (pin.imageHash) {
    const sameImg = await prisma.pin.findFirst({
      where: { id: { not: pinId }, imageHash: pin.imageHash, status: { in: ['published', 'publishing'] } },
    });
    if (sameImg) reasons.push(`Same image already published (pin ${sameImg.id.slice(0, 8)})`);
  }

  // title similarity + same destination
  const others = await prisma.pin.findMany({
    where: { id: { not: pinId }, destinationUrl: pin.destinationUrl, status: { in: ['published', 'publishing', 'scheduled', 'approved'] } },
    take: 50,
  });
  for (const o of others) {
    if (titleSimilarity(pin.title, o.title) > 0.7) {
      reasons.push(`Very similar title to ${o.status} pin "${o.title.slice(0, 60)}" with same destination URL`);
      break;
    }
  }
  return { duplicate: reasons.length > 0, reasons };
}

export async function publishingAllowed(): Promise<{ allowed: boolean; reason?: string }> {
  const pinsPerDay = Number(process.env.PINS_PER_DAY || '5');
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const count = await prisma.pin.count({ where: { status: 'published', publishedAt: { gte: since } } });
  if (count >= pinsPerDay) return { allowed: false, reason: `Daily limit reached (${count}/${pinsPerDay} in last 24h)` };
  const minInterval = Number(process.env.MIN_INTERVAL_MINUTES || '120');
  const last = await prisma.pin.findFirst({ where: { status: 'published' }, orderBy: { publishedAt: 'desc' } });
  if (last?.publishedAt && Date.now() - last.publishedAt.getTime() < minInterval * 60 * 1000) {
    const wait = Math.ceil((minInterval * 60 * 1000 - (Date.now() - last.publishedAt.getTime())) / 60000);
    return { allowed: false, reason: `Minimum interval: wait ~${wait} more minutes between publishes` };
  }
  return { allowed: true };
}
