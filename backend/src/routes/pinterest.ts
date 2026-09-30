import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { prisma, getSetting, setSetting, recordActivity } from '../db';
import { oauthStartUrl, exchangeCode, persistTokenResponse, listBoards, createBoard, getPin, connectionStatus } from '../services/pinterest/client';
import { publishPin } from '../services/publish';
import { checkDuplicate } from '../services/safety';
import { BoardCreateSchema } from '../validation';
import { logger } from '../logger';

export async function pinterestRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pinterest/status', async () => {
    const s = await connectionStatus();
    const clientConfigured = Boolean(process.env.PINTEREST_CLIENT_ID && process.env.PINTEREST_CLIENT_SECRET);
    return { ...s, clientConfigured };
  });

  app.get('/api/pinterest/oauth/start', async () => {
    const state = crypto.randomBytes(12).toString('hex');
    await setSetting('PINTEREST_OAUTH_STATE', state);
    const { url, missing } = oauthStartUrl(state);
    if (missing.length) return { ok: false, error: `Missing: ${missing.join(', ')}. Set them in .env / Settings → Pinterest.`, url: null };
    return { ok: true, url };
  });

  app.get('/api/pinterest/oauth/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string };
    if (!q.code) {
      const accept = String(req.headers.accept || '');
      if (accept.includes('text/html')) return reply.type('text/html').send(`<h1>PinForge AI</h1><p>Missing code. <a href="/">Back to app</a></p>`);
      return reply.code(400).send({ error: 'Missing ?code — user may have denied access' });
    }
    const saved = await getSetting('PINTEREST_OAUTH_STATE', '');
    if (saved && q.state && saved !== q.state) {
      return reply.code(400).send({ error: 'Invalid state (possible CSRF). Restart the connect flow.' });
    }
    try {
      const tok = await exchangeCode(q.code);
      await persistTokenResponse(tok);
      await recordActivity('pinterest', 'Pinterest account connected', {});
      const accept = String(req.headers.accept || '');
      if (accept.includes('text/html')) {
        return reply.type('text/html').send(`<h1>PinForge AI</h1><p>Pinterest connected. You can close this tab and return to the app.</p><a href="/">Open PinForge</a>`);
      }
      return { ok: true };
    } catch (e) {
      logger.error('Pinterest OAuth callback failed', { error: String(e).slice(0, 400) });
      return reply.code(500).send({ error: e instanceof Error ? e.message : 'OAuth exchange failed' });
    }
  });

  app.post('/api/pinterest/disconnect', async () => {
    await setSetting('PINTEREST_ACCESS_TOKEN', '');
    await setSetting('PINTEREST_REFRESH_TOKEN', '');
    await recordActivity('pinterest', 'Pinterest disconnected', {});
    return { ok: true };
  });

  app.get('/api/pinterest/boards', async (req, reply) => {
    try {
      const boards = await listBoards();
      // cache locally
      for (const b of boards) {
        await prisma.pinterestBoard.upsert({
          where: { pinterestId: b.id },
          create: { pinterestId: b.id, name: b.name, description: b.description || '', privacy: b.privacy || 'PUBLIC' },
          update: { name: b.name },
        }).catch(() => null);
      }
      const local = await prisma.pinterestBoard.findMany({ orderBy: { updatedAt: 'desc' } });
      return { boards, local };
    } catch (e) {
      const local = await prisma.pinterestBoard.findMany({ orderBy: { updatedAt: 'desc' } });
      return reply.code((e as { statusCode?: number }).statusCode === 401 ? 401 : 500).send({ error: e instanceof Error ? e.message : 'Failed to list boards', local });
    }
  });

  app.post('/api/pinterest/boards', async (req, reply) => {
    const parsed = BoardCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message.slice(0, 400) });
    try {
      const b = await createBoard(parsed.data.name, parsed.data.description, parsed.data.privacy);
      return { ok: true, board: b };
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : 'Create board failed' });
    }
  });

  app.get('/api/pinterest/pins', async (req, reply) => {
    const q = req.query as { boardId?: string };
    const published = await prisma.pin.findMany({ where: { status: 'published', ...(q.boardId ? { boardId: q.boardId } : {}) }, orderBy: { publishedAt: 'desc' }, take: 100 });
    // live status check for a single pin if requested
    return { pins: published };
  });

  app.get('/api/pinterest/pins/:id/live', async (req, reply) => {
    const { id } = req.params as { id: string };
    const pin = await prisma.pin.findUnique({ where: { id } });
    if (!pin?.pinterestPinId) return reply.code(404).send({ error: 'Pin has no Pinterest ID yet' });
    try {
      const live = await getPin(pin.pinterestPinId);
      return { ok: true, live };
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : 'Lookup failed' });
    }
  });

  app.post('/api/pinterest/publish/:pinId', async (req, reply) => {
    const { pinId } = req.params as { pinId: string };
    const body = ((req.body || {}) as { force?: boolean });
    try {
      const r = await publishPin(pinId, { force: body.force });
      return { ok: true, ...r };
    } catch (e) {
      const sc = (e as { statusCode?: number }).statusCode || 500;
      const dup = (e as { duplicate?: unknown }).duplicate;
      return reply.code(sc).send({ error: e instanceof Error ? e.message : 'Publish failed', duplicate: dup || undefined });
    }
  });

  app.get('/api/pins/:id/duplicate-check', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await checkDuplicate(id);
    } catch (e) {
      return reply.code(404).send({ error: 'Pin not found' });
    }
  });
}
