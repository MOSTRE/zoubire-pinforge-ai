import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import { env, ROOT_DIR } from './env';
import { logger } from './logger';
import { productRoutes } from './routes/products';
import { pinRoutes } from './routes/pins';
import { imageRoutes } from './routes/images';
import { pinterestRoutes } from './routes/pinterest';
import { miscRoutes } from './routes/misc';
import { startScheduler } from './services/scheduler';
import { publishPin } from './services/publish';

export function buildApp() {
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
  app.register(cors, { origin: true });
  app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  // Tolerate empty POST bodies (UI + curl often send a Content-Type header
  // with no payload). Empty JSON/urlencoded bodies become {} instead of 4xx.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      if (body === '' || body === null || body === undefined) return done(null, {});
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }));
    }
    void req;
  });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
    try {
      if (!body) return done(null, {});
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    } catch (e) {
      done(e as Error);
    }
    void req;
  });

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode || 500;
    logger.error('Request failed', { status, message: err.message.slice(0, 500) });
    reply.code(status).send({ error: status === 500 ? 'Internal server error (see logs)' : err.message });
  });

  app.get('/api/health', async () => ({ ok: true, app: 'PinForge AI', time: new Date().toISOString(), timezone: env.APP_TIMEZONE }));

  app.register(productRoutes);
  app.register(pinRoutes);
  app.register(imageRoutes);
  app.register(pinterestRoutes);
  app.register(miscRoutes);

  // serve frontend build if present
  const pub = path.join(__dirname, '..', '..', '..', 'frontend', 'dist');
  const pubAlt = path.join(ROOT_DIR, 'frontend', 'dist');
  const pubBackend = path.join(__dirname, '..', 'public');
  const dir = fs.existsSync(pubAlt) ? pubAlt : fs.existsSync(pub) ? pub : fs.existsSync(pubBackend) ? pubBackend : null;
  if (dir) {
    app.register(fastifyStatic, { root: dir, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  } else {
    app.get('/', async () => ({
      app: 'PinForge AI API',
      message: 'Frontend not built yet — run npm run build, or use the API directly.',
      docs: '/api/health',
    }));
  }
  return app;
}

async function main(): Promise<void> {
  const app = buildApp();
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info(`PinForge AI running at http://localhost:${env.PORT}`);
    startScheduler((pinId) => publishPin(pinId, { force: true }));
  } catch (e) {
    logger.error('Failed to start server', { error: String(e).slice(0, 500) });
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
