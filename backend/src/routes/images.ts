import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../env';
import { syntheticProvider, qualityCheck, sha256File } from '../services/images/base';
import { comfyProvider, loadWorkflow } from '../services/images/comfyui';
import { prisma } from '../db';

const jobs = new Map<string, { status: string; outputPath?: string; error?: string; provider?: string }>();

export async function imageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/images/providers', async () => {
    const [comfy, synth] = await Promise.all([comfyProvider.status(), syntheticProvider.status()]);
    return {
      providers: [
        { name: 'comfyui', ...comfy, url: process.env.COMFYUI_URL || env.COMFYUI_URL },
        { name: 'local-synthetic', ...synth },
      ],
    };
  });

  app.get('/api/images/providers/status', async () => {
    const [comfy, synth] = await Promise.all([comfyProvider.status(), syntheticProvider.status()]);
    return { comfyui: comfy, synthetic: synth };
  });

  app.get('/api/images/workflows', async () => {
    const dir = path.join(env.CONFIG_DIR, 'comfyui');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
    return { workflows: files.map((f) => f.replace(/\.json$/, '')) };
  });

  app.get('/api/images/workflows/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return reply.code(400).send({ error: 'Invalid workflow name' });
    try {
      return loadWorkflow(name);
    } catch (e) {
      return reply.code(404).send({ error: 'Workflow not found' });
    }
  });

  app.post('/api/images/generate', async (req, reply) => {
    const body = (req.body || {}) as { prompt?: string; provider?: string; width?: number; height?: number; workflow?: string };
    if (!body.prompt || body.prompt.length < 5) return reply.code(400).send({ error: 'prompt (min 5 chars) is required' });
    const id = crypto.randomBytes(8).toString('hex');
    const outPath = path.join(env.DATA_DIR, 'images', `${Date.now().toString(36)}-${id}.png`);
    jobs.set(id, { status: 'running' });
    const provider = body.provider === 'comfyui' ? comfyProvider : syntheticProvider;
    try {
      // try requested, fall back to synthetic if comfy fails
      let result;
      try {
        result = await provider.generate({ prompt: body.prompt, width: body.width || 1000, height: body.height || 1500, workflow: body.workflow }, outPath);
      } catch (e) {
        if (provider === comfyProvider) {
          result = await syntheticProvider.generate({ prompt: body.prompt, width: body.width || 1000, height: body.height || 1500 }, outPath);
        } else throw e;
      }
      const qc = await qualityCheck(result.outputPath);
      await prisma.imageGeneration.create({
        data: { provider: result.provider, prompt: String(body.prompt).slice(0, 2000), status: qc.ok ? 'succeeded' : 'failed', outputPath: result.outputPath, width: result.width, height: result.height, error: qc.ok ? null : qc.issues.join('; ') },
      });
      jobs.set(id, { status: qc.ok ? 'succeeded' : 'failed', outputPath: result.outputPath, provider: result.provider, error: qc.ok ? undefined : qc.issues.join('; ') });
      return { ok: qc.ok, jobId: id, ...result, qc };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      jobs.set(id, { status: 'failed', error: msg.slice(0, 500) });
      await prisma.imageGeneration.create({ data: { provider: provider.name, prompt: String(body.prompt).slice(0, 2000), status: 'failed', error: msg.slice(0, 500) } });
      return reply.code(500).send({ error: msg });
    }
  });

  app.get('/api/images/jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const j = jobs.get(id);
    if (!j) {
      const row = await prisma.imageGeneration.findUnique({ where: { id } }).catch(() => null);
      if (!row) return reply.code(404).send({ error: 'Job not found' });
      return { job: row };
    }
    return { jobId: id, ...j };
  });

  app.get('/api/images/file', async (req, reply) => {
    const { p } = req.query as { p?: string };
    if (!p) return reply.code(400).send({ error: 'Missing p' });
    const abs = path.resolve(p);
    const allowed = [path.resolve(env.DATA_DIR)];
    if (!allowed.some((a) => abs.startsWith(a)) || !fs.existsSync(abs)) {
      return reply.code(404).send({ error: 'File not found' });
    }
    reply.header('Content-Type', abs.endsWith('.png') ? 'image/png' : 'image/jpeg');
    return reply.send(fs.createReadStream(abs));
  });

  app.get('/api/images/hash', async (req, reply) => {
    const { p } = req.query as { p?: string };
    if (!p) return reply.code(400).send({ error: 'Missing p' });
    const abs = path.resolve(p);
    if (!abs.startsWith(path.resolve(env.DATA_DIR)) || !fs.existsSync(abs)) return reply.code(404).send({ error: 'File not found' });
    return { hash: sha256File(abs) };
  });
}
