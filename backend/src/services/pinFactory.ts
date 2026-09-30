import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prisma, recordActivity } from '../db';
import { env } from '../env';
import { logger } from '../logger';
import { generateSeoPack, analyzeProduct } from './ai/generate';
import { CREATIVE_ANGLES } from './ai/prompts';
import { syntheticProvider, qualityCheck, sha256File } from './images/base';
import { comfyProvider } from './images/comfyui';
import { composePinImage, fingerprint, type DesignTemplate } from './images/design';
import { safeJsonParse, slugify } from '../validation';

const TEMPLATES: DesignTemplate[] = ['headline-hero', 'minimal-ad', 'checklist', 'problem-solution', 'tutorial', 'before-after', 'bold-type'];

function angleFor(index: number, requested?: string[]): string {
  if (requested?.[index]) return requested[index];
  return CREATIVE_ANGLES[index % CREATIVE_ANGLES.length];
}

async function ensureAnalysis(productId: string): Promise<{ primaryKeywords: string[] }> {
  const existing = await prisma.productAnalysis.findUnique({ where: { productId } });
  if (existing) {
    return { primaryKeywords: safeJsonParse<string[]>(existing.primaryKeywords || '[]') || [] };
  }
  const row = await analyzeProduct(productId);
  return { primaryKeywords: safeJsonParse<string[]>(row.primaryKeywords || '[]') || [] };
}

export async function generatePins(productId: string, count: number, opts: { creativeAngles?: string[]; template?: string; boardId?: string | null; boardName?: string | null } = {}) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw Object.assign(new Error('Product not found'), { statusCode: 404 });
  const { primaryKeywords } = await ensureAnalysis(productId);
  const slug = slugify(product.name);
  const brandName = process.env.BRAND_NAME || 'Zoubire';

  const pins = [];
  for (let i = 0; i < count; i++) {
    const angle = angleFor(i, opts.creativeAngles);
    const template = (opts.template || TEMPLATES[(i + product.name.length) % TEMPLATES.length]) as DesignTemplate;
    const seo = await generateSeoPack(
      { id: product.id, name: product.name, description: product.description, url: product.url },
      angle,
      [...primaryKeywords, ...slug.split('-').slice(0, 3)]
    );

    // 1) base image
    const dir = path.join(env.DATA_DIR, 'pins', slug);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    const basePath = path.join(dir, `base-${stamp}.png`);
    const finalPath = path.join(dir, `pin-${stamp}.jpg`);

    let baseInfo: { outputPath: string; width: number; height: number; provider: string };
    let imageProviderUsed = 'local-synthetic';
    try {
      const comfyStatus = await comfyProvider.status();
      if (comfyStatus.ok && (process.env.COMFYUI_URL || env.COMFYUI_URL)) {
        try {
          const r = await comfyProvider.generate({ prompt: seo.imagePrompt, width: 1000, height: 1500 }, basePath);
          baseInfo = { outputPath: r.outputPath, width: r.width, height: r.height, provider: 'comfyui' };
          imageProviderUsed = 'comfyui';
          await prisma.imageGeneration.create({ data: { provider: 'comfyui', prompt: seo.imagePrompt.slice(0, 2000), status: 'succeeded', outputPath: basePath, width: r.width, height: r.height } });
        } catch (e) {
          logger.warn('ComfyUI generation failed, falling back to synthetic', { error: String(e).slice(0, 300) });
          const r = await syntheticProvider.generate({ prompt: seo.imagePrompt, width: 1000, height: 1500 }, basePath);
          baseInfo = { outputPath: r.outputPath, width: r.width, height: r.height, provider: 'local-synthetic' };
          await prisma.imageGeneration.create({ data: { provider: 'local-synthetic', prompt: seo.imagePrompt.slice(0, 2000), status: 'succeeded', outputPath: basePath, width: r.width, height: r.height } });
        }
      } else {
        const r = await syntheticProvider.generate({ prompt: seo.imagePrompt, width: 1000, height: 1500 }, basePath);
        baseInfo = { outputPath: r.outputPath, width: r.width, height: r.height, provider: 'local-synthetic' };
        await prisma.imageGeneration.create({ data: { provider: 'local-synthetic', prompt: seo.imagePrompt.slice(0, 2000), status: 'succeeded', outputPath: basePath, width: r.width, height: r.height } });
      }
    } catch (e) {
      await prisma.imageGeneration.create({ data: { provider: imageProviderUsed, prompt: seo.imagePrompt.slice(0, 2000), status: 'failed', error: String(e).slice(0, 500) } });
      throw e;
    }

    // QC base
    const qc = await qualityCheck(basePath);
    if (!qc.ok) {
      logger.warn('Base image QC issues', { issues: qc.issues, path: basePath });
    }

    // 2) design compose (headline overlay etc.)
    const headline = seo.title.length > 90 ? seo.title.slice(0, 90) : seo.title;
    await composePinImage(baseInfo.outputPath, finalPath, {
      template,
      headline,
      subtitle: seo.description.split('.')[0].slice(0, 160),
      cta: seo.cta || process.env.BRAND_DEFAULT_CTA || 'Learn more',
      brandName,
      footer: process.env.BRAND_FOOTER || '',
      textPosition: template === 'minimal-ad' ? 'bottom' : 'top',
    });

    const finalQc = await qualityCheck(finalPath);
    if (!finalQc.ok) throw new Error(`Final image failed QC: ${finalQc.issues.join('; ')}`);

    const hash = sha256File(finalPath);
    const fp = fingerprint(seo.title, seo.description, product.url, hash);

    const pin = await prisma.pin.create({
      data: {
        productId: product.id,
        title: seo.title,
        description: seo.description,
        primaryKeyword: seo.primaryKeyword,
        secondaryKeywords: JSON.stringify(seo.secondaryKeywords || []),
        hashtags: JSON.stringify(seo.hashtags || []),
        cta: seo.cta || '',
        destinationUrl: product.url,
        boardId: opts.boardId || null,
        boardName: opts.boardName || seo.boardSuggestion || null,
        imagePath: finalPath,
        imageHash: hash,
        contentFingerprint: fp,
        creativeAngle: angle,
        template,
        imagePrompt: seo.imagePrompt,
        status: 'draft',
      },
    });
    await prisma.pinAsset.create({ data: { pinId: pin.id, kind: 'base', path: basePath, width: baseInfo.width, height: baseInfo.height } });
    const bytes = fs.statSync(finalPath).size;
    await prisma.pinAsset.create({ data: { pinId: pin.id, kind: 'final', path: finalPath, width: finalQc.width, height: finalQc.height, bytes, hash } });
    pins.push(pin);
    await recordActivity('pin', `Pin generated (${angle}) for "${product.name}"`, { pinId: pin.id, productId: product.id });
  }
  await recordActivity('pin', `${pins.length} pin(s) generated`, { productId });
  return pins;
}

export async function regenerateImage(pinId: string): Promise<{ imagePath: string }> {
  const pin = await prisma.pin.findUnique({ where: { id: pinId }, include: { product: true } });
  if (!pin) throw Object.assign(new Error('Pin not found'), { statusCode: 404 });
  const dir = path.dirname(pin.imagePath || path.join(env.DATA_DIR, 'pins', slugify(pin.product.name)));
  fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  const basePath = path.join(dir, `base-${stamp}.png`);
  const finalPath = path.join(dir, `pin-${stamp}.jpg`);
  const prompt = pin.imagePrompt || `Premium Pinterest visual for ${pin.product.name}, ${pin.creativeAngle} angle, vertical 2:3, negative space for text`;
  let base: string;
  try {
    const st = await comfyProvider.status();
    if (st.ok) {
      try {
        const r = await comfyProvider.generate({ prompt, width: 1000, height: 1500 }, basePath);
        base = r.outputPath;
      } catch {
        base = (await syntheticProvider.generate({ prompt: prompt + ' variant ' + stamp, width: 1000, height: 1500 }, basePath)).outputPath;
      }
    } else {
      base = (await syntheticProvider.generate({ prompt: prompt + ' variant ' + stamp, width: 1000, height: 1500 }, basePath)).outputPath;
    }
  } catch (e) {
    throw new Error(`Image regeneration failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  await composePinImage(base, finalPath, {
    template: (pin.template as DesignTemplate) || 'headline-hero',
    headline: pin.title,
    subtitle: (pin.description || '').split('.')[0].slice(0, 160),
    cta: pin.cta || process.env.BRAND_DEFAULT_CTA || 'Learn more',
    brandName: process.env.BRAND_NAME || 'Zoubire',
    footer: process.env.BRAND_FOOTER || '',
  });
  const hash = sha256File(finalPath);
  await prisma.pin.update({ where: { id: pinId }, data: { imagePath: finalPath, imageHash: hash, contentFingerprint: fingerprint(pin.title, pin.description || '', pin.destinationUrl, hash), status: 'draft', publishError: null } });
  await prisma.pinAsset.create({ data: { pinId, kind: 'final', path: finalPath, hash } });
  await recordActivity('image', `Image regenerated for "${pin.title.slice(0, 60)}"`, { pinId });
  return { imagePath: finalPath };
}
