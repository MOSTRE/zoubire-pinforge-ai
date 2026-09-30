import { fetchGumroadCatalog } from '../services/gumroad';
import { prisma, recordActivity } from '../db';
import { logger } from '../logger';

async function main(): Promise<void> {
  const storeUrl = process.env.GUMROAD_STORE_URL || 'https://zoubire.gumroad.com';
  const r = await fetchGumroadCatalog(storeUrl);
  if (!r.ok) {
    logger.error('Sync failed', { error: r.error });
    process.exitCode = 1;
    return;
  }
  let added = 0;
  for (const p of r.products) {
    const ex = await prisma.product.findUnique({ where: { url: p.url } });
    if (!ex) {
      await prisma.product.create({
        data: { name: p.name, url: p.url, permalink: p.permalink, gumroadId: p.gumroadId, thumbnailUrl: p.thumbnailUrl, priceCents: p.priceCents ?? null, currency: p.currency || 'usd', tags: '[]', source: 'catalog', status: 'active' },
      });
      added++;
    }
  }
  await recordActivity('import', `CLI sync: ${r.products.length} found, ${added} new`, {});
  logger.info(`Sync done: ${r.products.length} found, ${added} new`);
  await prisma.$disconnect();
}

if (require.main === module) {
  main();
}
