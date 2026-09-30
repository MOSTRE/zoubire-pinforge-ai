import cron from 'node-cron';
import { prisma, getSetting, recordActivity } from '../db';
import { logger } from '../logger';

let started = false;

function parseHM(s: string, fallback: string): { h: number; m: number } {
  const src = s || fallback;
  const m = src.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { h: 9, m: 0 };
  return { h: Math.min(23, Number(m[1])), m: Math.min(59, Number(m[2])) };
}

/** Spread N pins per day across [start,end] window. Returns Date[] for a given day. */
export function planDaySlots(day: Date, pinsPerDay: number, startHM: string, endHM: string, jitterMin = 15): Date[] {
  const s = parseHM(startHM, '09:00');
  const e = parseHM(endHM, '21:00');
  const start = new Date(day); start.setHours(s.h, s.m, 0, 0);
  const end = new Date(day); end.setHours(e.h, e.m, 0, 0);
  if (end <= start || pinsPerDay <= 0) return [];
  if (pinsPerDay === 1) return [new Date(start.getTime() + (end.getTime() - start.getTime()) / 2)];
  const step = (end.getTime() - start.getTime()) / (pinsPerDay - 1);
  return Array.from({ length: pinsPerDay }, (_, i) => {
    const jitter = (Math.random() - 0.5) * 2 * jitterMin * 60000;
    return new Date(start.getTime() + step * i + jitter);
  });
}

export async function autoScheduleApproved(): Promise<number> {
  const mode = (await getSetting('PUBLISHING_MODE', process.env.PUBLISHING_MODE || 'manual')).toLowerCase();
  if (mode !== 'auto') return 0;
  const pinsPerDay = Number((await getSetting('SCHEDULER_PINS_PER_DAY', process.env.SCHEDULER_PINS_PER_DAY || '5')) || '5');
  const start = await getSetting('SCHEDULER_START_TIME', process.env.SCHEDULER_START_TIME || '09:00');
  const end = await getSetting('SCHEDULER_END_TIME', process.env.SCHEDULER_END_TIME || '21:00');
  const approved = await prisma.pin.findMany({ where: { status: 'approved' }, orderBy: { createdAt: 'asc' }, take: pinsPerDay * 2 });
  if (!approved.length) return 0;
  const today = new Date();
  const slots = planDaySlots(today, Math.min(pinsPerDay, approved.length), start, end);
  let n = 0;
  for (let i = 0; i < Math.min(slots.length, approved.length); i++) {
    await prisma.pin.update({ where: { id: approved[i].id }, data: { status: 'scheduled', scheduledAt: slots[i] } });
    await prisma.publishJob.create({ data: { pinId: approved[i].id, status: 'pending', scheduledAt: slots[i] } });
    n++;
  }
  if (n) await recordActivity('scheduler', `Auto-scheduled ${n} pin(s)`, {});
  return n;
}

export async function runDueJobs(publishFn: (pinId: string, force?: boolean) => Promise<unknown>): Promise<number> {
  const now = new Date();
  const due = await prisma.publishJob.findMany({
    where: { status: 'pending', scheduledAt: { lte: now } },
    orderBy: { scheduledAt: 'asc' },
    take: 10,
  });
  let n = 0;
  for (const j of due) {
    try {
      await prisma.publishJob.update({ where: { id: j.id }, data: { status: 'running', attempts: { increment: 1 }, runAt: now } });
      await publishFn(j.pinId, true);
      await prisma.publishJob.update({ where: { id: j.id }, data: { status: 'succeeded' } });
      n++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('Scheduled publish failed', { jobId: j.id, error: msg });
      await prisma.publishJob.update({ where: { id: j.id }, data: { status: 'failed', error: msg.slice(0, 1000) } });
    }
  }
  return n;
}

export function startScheduler(publishFn: (pinId: string, force?: boolean) => Promise<unknown>): void {
  if (started) return;
  started = true;
  cron.schedule('* * * * *', async () => {
    try {
      await autoScheduleApproved();
      await runDueJobs(publishFn);
    } catch (e) {
      logger.error('Scheduler tick failed', { error: String(e).slice(0, 300) });
    }
  });
  logger.info('Scheduler started (every minute)');
}
