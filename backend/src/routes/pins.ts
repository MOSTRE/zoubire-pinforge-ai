import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import { prisma, recordActivity } from '../db';
import { PinGenerateSchema, PinUpdateSchema } from '../validation';
import { generatePins, regenerateImage } from '../services/pinFactory';
import { generateSeoPack } from '../services/ai/generate';
import { logger } from '../logger';

export async function pinRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pins', async (req) => {
    const q = req.query as { status?: string; productId?: string; search?: string; take?: string };
    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.productId) where.productId = q.productId;
    if (q.search) where.title = { contains: q.search };
    const pins = await prisma.pin.findMany({
      where, orderBy: { createdAt: 'desc' }, take: Math.min(200, Number(q.take) || 100),
      include: { product: { select: { id: true, name: true, url: true, thumbnailUrl: true } } },
    });
    return { pins };
  });

  app.get('/api/pins/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const pin = await prisma.pin.findUnique({ where: { id }, include: { product: true, assets: true, jobs: { orderBy: { createdAt: 'desc' }, take: 10 } } });
    if (!pin) return reply.code(404).send({ error: 'Pin not found' });
    return { pin };
  });

  app.post('/api/pins/generate', async (req, reply) => {
    const parsed = PinGenerateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message.slice(0, 500) });
    try {
      const pins = await generatePins(parsed.data.productId, parsed.data.count, {
        creativeAngles: parsed.data.creativeAngles, template: parsed.data.template,
        boardId: parsed.data.boardId, boardName: parsed.data.boardName,
      });
      return { ok: true, pins };
    } catch (e) {
      logger.error('Pin generation failed', { error: String(e).slice(0, 500) });
      return reply.code(500).send({ error: e instanceof Error ? e.message : 'Generation failed' });
    }
  });

  app.patch('/api/pins/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = PinUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message.slice(0, 500) });
    const d = parsed.data;
    const pin = await prisma.pin.findUnique({ where: { id } });
    if (!pin) return reply.code(404).send({ error: 'Pin not found' });
    const updated = await prisma.pin.update({
      where: { id },
      data: {
        ...(d.title !== undefined ? { title: d.title } : {}),
        ...(d.description !== undefined ? { description: d.description } : {}),
        ...(d.primaryKeyword !== undefined ? { primaryKeyword: d.primaryKeyword } : {}),
        ...(d.secondaryKeywords !== undefined ? { secondaryKeywords: JSON.stringify(d.secondaryKeywords) } : {}),
        ...(d.hashtags !== undefined ? { hashtags: JSON.stringify(d.hashtags) } : {}),
        ...(d.cta !== undefined ? { cta: d.cta } : {}),
        ...(d.destinationUrl !== undefined ? { destinationUrl: d.destinationUrl } : {}),
        ...(d.boardId !== undefined ? { boardId: d.boardId } : {}),
        ...(d.boardName !== undefined ? { boardName: d.boardName } : {}),
        ...(d.template !== undefined ? { template: d.template } : {}),
        ...(d.status !== undefined ? { status: d.status } : {}),
        ...(d.scheduledAt !== undefined ? { scheduledAt: d.scheduledAt ? new Date(d.scheduledAt) : null } : {}),
      },
    });
    return { ok: true, pin: updated };
  });

  app.post('/api/pins/:id/regenerate-seo', async (req, reply) => {
    const { id } = req.params as { id: string };
    const pin = await prisma.pin.findUnique({ where: { id }, include: { product: true } });
    if (!pin) return reply.code(404).send({ error: 'Pin not found' });
    try {
      const angles = [pin.creativeAngle, 'educational', 'checklist', 'benefits', 'beginner-guide'];
      const next = angles[(angles.indexOf(pin.creativeAngle) + 1 + Date.now() % 4) % angles.length];
      const seo = await generateSeoPack({ id: pin.product.id, name: pin.product.name, description: pin.product.description, url: pin.product.url }, next, [pin.primaryKeyword]);
      const updated = await prisma.pin.update({
        where: { id },
        data: {
          title: seo.title, description: seo.description, primaryKeyword: seo.primaryKeyword,
          secondaryKeywords: JSON.stringify(seo.secondaryKeywords), cta: seo.cta, imagePrompt: seo.imagePrompt,
          creativeAngle: next, status: 'draft',
        },
      });
      await recordActivity('pin', `SEO regenerated (${next})`, { pinId: id });
      return { ok: true, pin: updated };
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : 'Regeneration failed' });
    }
  });

  app.post('/api/pins/:id/regenerate-image', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const r = await regenerateImage(id);
      const pin = await prisma.pin.findUnique({ where: { id } });
      return { ok: true, imagePath: r.imagePath, pin };
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : 'Image regeneration failed' });
    }
  });

  app.post('/api/pins/:id/approve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const pin = await prisma.pin.findUnique({ where: { id } });
    if (!pin) return reply.code(404).send({ error: 'Pin not found' });
    const updated = await prisma.pin.update({ where: { id }, data: { status: 'approved' } });
    await recordActivity('approve', `Pin approved: "${pin.title.slice(0, 80)}"`, { pinId: id });
    return { ok: true, pin: updated };
  });

  app.delete('/api/pins/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const pin = await prisma.pin.findUnique({ where: { id } });
    if (!pin) return reply.code(404).send({ error: 'Pin not found' });
    try {
      if (pin.imagePath && fs.existsSync(pin.imagePath)) fs.unlinkSync(pin.imagePath);
    } catch { /* ignore */ }
    await prisma.pin.delete({ where: { id } });
    return { ok: true };
  });

  app.get('/api/pins/:id/image', async (req, reply) => {
    const { id } = req.params as { id: string };
    const pin = await prisma.pin.findUnique({ where: { id } });
    if (!pin?.imagePath || !fs.existsSync(pin.imagePath)) return reply.code(404).send({ error: 'Image not found' });
    const ext = pin.imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    reply.header('Content-Type', ext);
    return reply.send(fs.createReadStream(pin.imagePath));
  });
}
