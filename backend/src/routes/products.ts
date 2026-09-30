import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, recordActivity } from '../db';
import { fetchGumroadCatalog, enrichProductFromPage, parseProductCsv } from '../services/gumroad';
import { analyzeProduct } from '../services/ai/generate';
import { logger } from '../logger';

export async function productRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/products', async (req) => {
    const q = (req.query as { search?: string; status?: string }).search || '';
    const where = q
      ? { OR: [{ name: { contains: q } }, { url: { contains: q } }] }
      : {};
    const products = await prisma.product.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 200, include: { _count: { select: { pins: true } }, analysis: true } });
    return { products };
  });

  app.get('/api/products/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const product = await prisma.product.findUnique({ where: { id }, include: { analysis: true, pins: { orderBy: { createdAt: 'desc' }, take: 50 }, keywords: true } });
    if (!product) return reply.code(404).send({ error: 'Product not found' });
    return { product };
  });

  app.post('/api/products/sync', async () => {
    const storeUrl = process.env.GUMROAD_STORE_URL || 'https://zoubire.gumroad.com';
    const result = await fetchGumroadCatalog(storeUrl);
    if (!result.ok) {
      logger.warn('Gumroad sync failed', { error: result.error });
      await prisma.productSource.create({ data: { kind: 'catalog_sync', detail: result.error || 'failed', count: 0 } });
      return { ok: false, error: result.error, method: result.method, summary: { found: 0, new: 0, updated: 0, unchanged: 0 } };
    }
    let added = 0, updated = 0, unchanged = 0;
    for (const p of result.products) {
      const existing = await prisma.product.findUnique({ where: { url: p.url } });
      // best-effort enrichment (description) without blocking too long
      let desc = '';
      let thumb = p.thumbnailUrl || null;
      let tags: string[] = p.tags || [];
      if (!existing) {
        try {
          const en = await enrichProductFromPage(p.url);
          if (en.description) desc = en.description.slice(0, 4000);
          if (en.thumbnailUrl && !thumb) thumb = en.thumbnailUrl;
          if (en.tags?.length) tags = en.tags;
        } catch { /* ignore */ }
      }
      if (!existing) {
        await prisma.product.create({
          data: {
            gumroadId: p.gumroadId, permalink: p.permalink, name: p.name, url: p.url,
            description: desc, thumbnailUrl: thumb, priceCents: p.priceCents ?? null,
            currency: p.currency || 'usd', tags: JSON.stringify(tags), status: 'active', source: 'catalog',
          },
        });
        added++;
      } else {
        const changed =
          existing.name !== p.name || existing.thumbnailUrl !== (p.thumbnailUrl || existing.thumbnailUrl) ||
          existing.priceCents !== (p.priceCents ?? existing.priceCents) || existing.permalink !== (p.permalink || existing.permalink);
        if (changed) {
          await prisma.product.update({
            where: { id: existing.id },
            data: { name: p.name, thumbnailUrl: p.thumbnailUrl || existing.thumbnailUrl, priceCents: p.priceCents ?? existing.priceCents, permalink: p.permalink || existing.permalink, gumroadId: p.gumroadId || existing.gumroadId, status: 'active', lastSyncedAt: new Date() },
          });
          updated++;
        } else {
          await prisma.product.update({ where: { id: existing.id }, data: { lastSyncedAt: new Date() } });
          unchanged++;
        }
      }
    }
    // mark removed: products not seen in catalog
    const seenUrls = new Set(result.products.map((p) => p.url));
    const all = await prisma.product.findMany({ where: { status: 'active', source: 'catalog' }, select: { id: true, url: true } });
    for (const a of all) {
      if (!seenUrls.has(a.url)) await prisma.product.update({ where: { id: a.id }, data: { status: 'removed' } });
    }
    await prisma.productSource.create({ data: { kind: 'catalog_sync', detail: `method=${result.method}`, count: result.products.length } });
    await recordActivity('import', `Gumroad sync: ${result.products.length} found (${added} new, ${updated} updated)`, {});
    return { ok: true, method: result.method, summary: { found: result.products.length, new: added, updated, unchanged } };
  });

  app.post('/api/products/import', async (req, reply) => {
    const body = (req.body || {}) as { products?: Array<{ name: string; url: string; description?: string; thumbnailUrl?: string; priceCents?: number | null; tags?: string[] }>; csv?: string };
    let list = body.products || [];
    if (body.csv) {
      try {
        list = [...list, ...parseProductCsv(body.csv)];
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'Invalid CSV' });
      }
    }
    if (!list.length) return reply.code(400).send({ error: 'No products provided. Supply products[] or csv.' });
    let added = 0, skipped = 0;
    for (const p of list) {
      if (!p.name || !p.url) { skipped++; continue; }
      try {
        new URL(p.url);
      } catch { skipped++; continue; }
      const existing = await prisma.product.findUnique({ where: { url: p.url } });
      if (existing) { skipped++; continue; }
      await prisma.product.create({
        data: {
          name: p.name.slice(0, 300), url: p.url, description: (p.description || '').slice(0, 4000),
          thumbnailUrl: p.thumbnailUrl || null, priceCents: p.priceCents ?? null,
          tags: JSON.stringify(p.tags || []), source: body.csv ? 'csv' : 'manual', status: 'active',
        },
      });
      added++;
    }
    await recordActivity('import', `Manual import: ${added} added, ${skipped} skipped`, {});
    return { ok: true, added, skipped };
  });

  app.post('/api/products/:id/analyze', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const row = await analyzeProduct(id);
      return { ok: true, analysis: row };
    } catch (e) {
      logger.error('Analyze failed', { error: String(e).slice(0, 400) });
      return reply.code(500).send({ error: e instanceof Error ? e.message : 'Analysis failed' });
    }
  });

  app.delete('/api/products/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const pins = await prisma.pin.count({ where: { productId: id } });
    if (pins > 0) {
      await prisma.product.update({ where: { id }, data: { status: 'hidden' } });
      return { ok: true, hidden: true };
    }
    await prisma.product.delete({ where: { id } }).catch(() => null);
    return { ok: true };
  });

  app.get('/api/gumroad/preview', async () => {
    const storeUrl = process.env.GUMROAD_STORE_URL || 'https://zoubire.gumroad.com';
    const r = await fetchGumroadCatalog(storeUrl);
    return r;
  });
}
