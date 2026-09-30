import type { FastifyInstance } from 'fastify';
import { prisma, getSetting, setSetting, recordActivity } from '../db';
import { ScheduleSchema, SettingsSchema } from '../validation';
import { planDaySlots } from '../services/scheduler';
import { publishPin } from '../services/publish';
import { ollamaProvider } from '../services/ai/ollama';
import { comfyProvider } from '../services/images/comfyui';
import { fetchGumroadCatalog } from '../services/gumroad';

const SETTING_KEYS = [
  'GUMROAD_STORE_URL', 'OLLAMA_BASE_URL', 'OLLAMA_MODEL', 'COMFYUI_URL', 'COMFYUI_WORKFLOW',
  'PINTEREST_CLIENT_ID', 'PINTEREST_REDIRECT_URI', 'PINTEREST_SCOPES',
  'APP_TIMEZONE', 'SCHEDULER_START_TIME', 'SCHEDULER_END_TIME', 'SCHEDULER_PINS_PER_DAY',
  'PUBLISHING_MODE', 'PINS_PER_DAY', 'MIN_INTERVAL_MINUTES',
  'BRAND_NAME', 'BRAND_STORE_URL', 'BRAND_DEFAULT_CTA', 'BRAND_FOOTER',
];

export async function miscRoutes(app: FastifyInstance): Promise<void> {
  // ---- dashboard ----
  app.get('/api/dashboard', async () => {
    const [products, pins, queued, published, failed, jobsFailed, activity] = await Promise.all([
      prisma.product.count({ where: { status: 'active' } }),
      prisma.pin.count(),
      prisma.pin.count({ where: { status: { in: ['approved', 'scheduled'] } } }),
      prisma.pin.count({ where: { status: 'published' } }),
      prisma.pin.count({ where: { status: 'failed' } }),
      prisma.publishJob.count({ where: { status: 'failed' } }),
      prisma.activityEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
    ]);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const today = await prisma.pin.findMany({
      where: { scheduledAt: { gte: start, lte: end }, status: { in: ['scheduled', 'approved'] } },
      orderBy: { scheduledAt: 'asc' }, take: 20,
      include: { product: { select: { name: true } } },
    });
    return { products, pinsGenerated: pins, pinsQueued: queued, pinsPublished: published, failedJobs: failed + jobsFailed, today, activity };
  });

  // ---- queue ----
  app.get('/api/queue', async (req) => {
    const q = req.query as { status?: string };
    const pins = await prisma.pin.findMany({
      where: q.status ? { status: q.status } : { status: { in: ['draft', 'approved', 'scheduled', 'publishing', 'failed'] } },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      include: { product: { select: { id: true, name: true, url: true } } },
    });
    return { queue: pins };
  });

  app.post('/api/queue/schedule', async (req, reply) => {
    const parsed = ScheduleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message.slice(0, 400) });
    const pin = await prisma.pin.findUnique({ where: { id: parsed.data.pinId } });
    if (!pin) return reply.code(404).send({ error: 'Pin not found' });
    const updated = await prisma.pin.update({ where: { id: pin.id }, data: { status: 'scheduled', scheduledAt: new Date(parsed.data.scheduledAt) } });
    await prisma.publishJob.create({ data: { pinId: pin.id, status: 'pending', scheduledAt: new Date(parsed.data.scheduledAt) } });
    await recordActivity('schedule', `Scheduled "${pin.title.slice(0, 60)}"`, { pinId: pin.id });
    return { ok: true, pin: updated };
  });

  app.delete('/api/queue/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await prisma.publishJob.findUnique({ where: { id } });
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    await prisma.publishJob.delete({ where: { id } });
    return { ok: true };
  });

  app.get('/api/jobs', async () => {
    const jobs = await prisma.publishJob.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { pin: { select: { id: true, title: true } } } });
    return { jobs };
  });

  app.post('/api/queue/publish-now/:pinId', async (req, reply) => {
    const { pinId } = req.params as { pinId: string };
    try {
      const r = await publishPin(pinId, { force: true });
      return { ok: true, ...r };
    } catch (e) {
      return reply.code((e as { statusCode?: number }).statusCode || 500).send({ error: e instanceof Error ? e.message : 'Publish failed' });
    }
  });

  // ---- scheduler ----
  app.get('/api/scheduler/plan', async () => {
    const pinsPerDay = Number(await getSetting('SCHEDULER_PINS_PER_DAY', process.env.SCHEDULER_PINS_PER_DAY || '5'));
    const start = await getSetting('SCHEDULER_START_TIME', process.env.SCHEDULER_START_TIME || '09:00');
    const end = await getSetting('SCHEDULER_END_TIME', process.env.SCHEDULER_END_TIME || '21:00');
    const days: Array<{ date: string; slots: string[]; pins: unknown }> = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(); day.setDate(day.getDate() + d);
      const slots = planDaySlots(day, pinsPerDay, start, end, 0);
      const s = new Date(day); s.setHours(0, 0, 0, 0);
      const e2 = new Date(day); e2.setHours(23, 59, 59, 999);
      const pins = await prisma.pin.findMany({ where: { scheduledAt: { gte: s, lte: e2 } }, select: { id: true, title: true, scheduledAt: true, status: true }, orderBy: { scheduledAt: 'asc' } });
      days.push({ date: day.toISOString().slice(0, 10), slots: slots.map((x) => x.toISOString()), pins });
    }
    return { pinsPerDay, start, end, timezone: process.env.APP_TIMEZONE || 'Europe/Madrid', days };
  });

  // ---- settings ----
  app.get('/api/settings', async () => {
    const out: Record<string, string> = {};
    for (const k of SETTING_KEYS) out[k] = await getSetting(k, process.env[k] || '');
    // never expose secrets
    out.PINTEREST_CLIENT_SECRET = (await getSetting('PINTEREST_CLIENT_SECRET', process.env.PINTEREST_CLIENT_SECRET || '')) ? '***configured***' : '';
    out.GUMROAD_API_TOKEN = (await getSetting('GUMROAD_API_TOKEN', process.env.GUMROAD_API_TOKEN || '')) ? '***configured***' : '';
    return { settings: out };
  });

  app.patch('/api/settings', async (req, reply) => {
    const parsed = SettingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid settings payload' });
    for (const [k, v] of Object.entries(parsed.data)) {
      if (!SETTING_KEYS.includes(k) && k !== 'PINTEREST_CLIENT_SECRET' && k !== 'GUMROAD_API_TOKEN') continue;
      if (v === '***configured***') continue; // don't overwrite secrets with mask
      await setSetting(k, String(v).slice(0, 2000));
      process.env[k] = String(v);
    }
    return { ok: true };
  });

  app.post('/api/settings/test/:which', async (req, reply) => {
    const { which } = req.params as { which: string };
    try {
      if (which === 'gumroad') {
        const r = await fetchGumroadCatalog(process.env.GUMROAD_STORE_URL || 'https://zoubire.gumroad.com');
        return r.ok ? { ok: true, detail: `${r.products.length} products found` } : { ok: false, error: r.error };
      }
      if (which === 'ollama') {
        const s = await ollamaProvider.status();
        return s.ok ? { ok: true, detail: s.detail, model: s.model } : { ok: false, error: s.detail };
      }
      if (which === 'comfyui') {
        const s = await comfyProvider.status();
        return s.ok ? { ok: true, detail: s.detail } : { ok: false, error: s.detail || 'ComfyUI not reachable — synthetic fallback will be used' };
      }
      if (which === 'pinterest') {
        const { connectionStatus } = await import('../services/pinterest/client');
        const s = await connectionStatus();
        return s.connected ? { ok: true, detail: s.detail } : { ok: false, error: s.detail };
      }
      return reply.code(400).send({ error: 'Unknown test target' });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  app.get('/api/ollama/models', async () => {
    const models = await ollamaProvider.listModels();
    return { models, current: process.env.OLLAMA_MODEL || '' };
  });

  // ---- analytics (honest: local counts + live lookup note) ----
  app.get('/api/analytics', async () => {
    const byStatus = await prisma.pin.groupBy({ by: ['status'], _count: { status: true } });
    const byProduct = await prisma.pin.groupBy({ by: ['productId'], _count: { productId: true }, where: { status: 'published' } });
    const products = await prisma.product.findMany({ select: { id: true, name: true } });
    const nameById = new Map(products.map((p) => [p.id, p.name]));
    return {
      byStatus: byStatus.map((b) => ({ status: b.status, count: b._count.status })),
      topProducts: byProduct.map((b) => ({ productId: b.productId, name: nameById.get(b.productId) || b.productId, published: b._count.productId })).sort((a, b) => b.published - a.published).slice(0, 10),
      pinterestMetrics: null,
      notice: 'Analytics unavailable for this connection. Pinterest does not expose impressions/saves/clicks on the standard organic pins endpoint — connect with analytics scopes when available.',
    };
  });

  app.get('/api/activity', async () => {
    const events = await prisma.activityEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    return { events };
  });
}
