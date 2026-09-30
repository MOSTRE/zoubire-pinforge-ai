import { prisma, recordActivity } from '../../db';
import { AnalysisSchema, SeoPackSchema, safeJsonParse } from '../../validation';
import { ollamaProvider } from './ollama';
import { localHeuristicProvider } from './heuristic';
import { sanitizeCopy } from './types';
import { analysisPrompt, seoPrompt, CREATIVE_ANGLES } from './prompts';
import { logger } from '../../logger';

async function tryProvider<T>(prompt: string, fallback: T): Promise<{ data: T; provider: string; model: string }> {
  try {
    const r = await ollamaProvider.generateJson<T>(prompt, fallback);
    return r;
  } catch (e) {
    logger.warn('Ollama generation failed, using heuristic fallback', { error: String(e).slice(0, 300) });
    const r = await localHeuristicProvider.generateJson<T>(prompt, fallback);
    return r;
  }
}

function keywordsFromName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !['with', 'from', 'your', 'guide', 'pro'].includes(w))
    .slice(0, 6);
}

export function heuristicAnalysis(product: { name: string; description?: string; tags?: string[] }) {
  const kws = [...keywordsFromName(product.name), ...(product.tags || []).slice(0, 4)];
  const uniq = [...new Set(kws)].slice(0, 8);
  return {
    category: 'Digital product',
    targetAudience: `People interested in ${product.name.split('—')[0].trim().slice(0, 120)}`,
    buyerIntent: 'Looking for a practical, ready-to-use digital guide or system',
    problemSolved: (product.description || '').slice(0, 300) || 'An everyday organization or planning problem described on the Gumroad page',
    benefit: `A structured, easy-to-follow resource based on the product page`,
    useCases: ['Personal planning', 'Home organization', 'Getting started quickly'],
    searchIntent: 'Informational and commercial: ideas, checklists, and templates',
    contentAngles: [...CREATIVE_ANGLES].slice(0, 8),
    primaryKeywords: uniq.slice(0, 3),
    secondaryKeywords: uniq.slice(3, 7),
    longTailKeywords: uniq.slice(0, 3).map((k) => `${k} ideas for beginners`),
    relatedTopics: uniq.slice(0, 5),
    suggestedBoards: ['Digital Planning Ideas', 'Home & Life Organization', 'Productivity Systems'],
    pinConcepts: [
      `Checklist inspired by ${product.name}`,
      `Beginner guide angle for ${product.name}`,
      `Mistakes to avoid angle`,
      `Before/after organization concept`,
      `Product-focused showcase`,
    ],
  };
}

export async function analyzeProduct(productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error('Product not found');
  const tags: string[] = safeJsonParse<string[]>(product.tags || '[]') || [];
  const prompt = analysisPrompt({ name: product.name, description: product.description || '', tags, priceCents: product.priceCents });

  let data: Record<string, unknown>;
  let provider = 'ollama';
  let modelUsed = process.env.OLLAMA_MODEL || '';
  try {
    const r = await ollamaProvider.generateJson<Record<string, unknown>>(prompt, {});
    const parsed = AnalysisSchema.safeParse(r.data);
    if (!parsed.success) throw new Error('AI analysis failed validation: ' + parsed.error.message.slice(0, 300));
    data = parsed.data as Record<string, unknown>;
    provider = r.provider; modelUsed = r.model;
  } catch (e) {
    logger.warn('Analysis fallback to heuristic', { error: String(e).slice(0, 300) });
    const h = heuristicAnalysis({ name: product.name, description: product.description || '', tags });
    const parsed = AnalysisSchema.parse(h);
    data = parsed as Record<string, unknown>;
    provider = 'local-heuristic'; modelUsed = 'heuristic-v1';
  }

  const row = await prisma.productAnalysis.upsert({
    where: { productId },
    create: {
      productId,
      category: String(data.category || ''),
      targetAudience: String(data.targetAudience || ''),
      buyerIntent: String(data.buyerIntent || ''),
      problemSolved: String(data.problemSolved || ''),
      benefit: String(data.benefit || ''),
      useCases: JSON.stringify(data.useCases || []),
      searchIntent: String(data.searchIntent || ''),
      contentAngles: JSON.stringify(data.contentAngles || []),
      primaryKeywords: JSON.stringify(data.primaryKeywords || []),
      secondaryKeywords: JSON.stringify(data.secondaryKeywords || []),
      longTailKeywords: JSON.stringify(data.longTailKeywords || []),
      relatedTopics: JSON.stringify(data.relatedTopics || []),
      suggestedBoards: JSON.stringify(data.suggestedBoards || []),
      pinConcepts: JSON.stringify(data.pinConcepts || []),
      rawJson: JSON.stringify(data).slice(0, 8000),
      provider, model: modelUsed,
    },
    update: {
      category: String(data.category || ''),
      targetAudience: String(data.targetAudience || ''),
      buyerIntent: String(data.buyerIntent || ''),
      problemSolved: String(data.problemSolved || ''),
      benefit: String(data.benefit || ''),
      useCases: JSON.stringify(data.useCases || []),
      searchIntent: String(data.searchIntent || ''),
      contentAngles: JSON.stringify(data.contentAngles || []),
      primaryKeywords: JSON.stringify(data.primaryKeywords || []),
      secondaryKeywords: JSON.stringify(data.secondaryKeywords || []),
      longTailKeywords: JSON.stringify(data.longTailKeywords || []),
      relatedTopics: JSON.stringify(data.relatedTopics || []),
      suggestedBoards: JSON.stringify(data.suggestedBoards || []),
      pinConcepts: JSON.stringify(data.pinConcepts || []),
      rawJson: JSON.stringify(data).slice(0, 8000),
      provider, model: modelUsed,
    },
  });

  // sync keywords table
  await prisma.productKeyword.deleteMany({ where: { productId } });
  const all = [
    ...((data.primaryKeywords as string[]) || []).map((k) => ({ k, kind: 'primary' })),
    ...((data.secondaryKeywords as string[]) || []).map((k) => ({ k, kind: 'secondary' })),
    ...((data.longTailKeywords as string[]) || []).map((k) => ({ k, kind: 'longtail' })),
  ].slice(0, 20);
  for (const { k, kind } of all) {
    if (!k) continue;
    await prisma.productKeyword.create({ data: { productId, keyword: String(k).slice(0, 120), kind } });
  }

  await prisma.aiGeneration.create({
    data: { kind: 'analysis', productId, provider, model: modelUsed, input: JSON.stringify({ name: product.name }).slice(0, 2000), output: JSON.stringify(data).slice(0, 8000) },
  });
  await recordActivity('analysis', `AI analysis ready for "${product.name}"`, { productId });
  return row;
}

/** Angle-aware offline fallback so "Generate 5" still yields distinct copy when Ollama is offline. */
export function fallbackSeoForAngle(product: { name: string }, angle: string): { titleSuffix: string; description: string; visual: string } {
  const short = product.name.split('—')[0].split('-')[0].trim().slice(0, 60);
  const map: Record<string, { titleSuffix: string; description: string; visual: string }> = {
    'problem-solution': {
      titleSuffix: 'Fix This Common Struggle',
      description: `Struggling with ${short.toLowerCase()}? See a calmer, more organized approach and how this resource helps. Save this for later and tap through for details.`,
      visual: 'before/after style organized scene, satisfying transformation mood',
    },
    educational: {
      titleSuffix: 'What to Know First',
      description: `A quick educational overview around ${short}: key ideas, how it works, and what to look at before you start. Save this explainer.`,
      visual: 'clean tutorial-style flat lay, notebook and planning elements, bright daylight',
    },
    checklist: {
      titleSuffix: 'Simple Checklist to Follow',
      description: `A simple checklist inspired by ${short} so you do not miss a step. Save this checklist and tap through to see the full resource.`,
      visual: 'checklist notepad with checkmarks, tidy desk, soft morning light',
    },
    comparison: {
      titleSuffix: 'Before You Choose, Compare',
      description: `How does ${short} compare to doing it the hard way? A calm side-by-side look to help you decide. Save and compare.`,
      visual: 'split-composition scene, cluttered versus organized halves',
    },
    productivity: {
      titleSuffix: 'Get It Done Faster',
      description: `A productivity-focused look at ${short}: streamline the routine and save time. Save this system idea for your next reset.`,
      visual: 'focused workspace, timer and tidy setup, energetic daylight',
    },
    'beginner-guide': {
      titleSuffix: 'Beginner-Friendly Start Guide',
      description: `New to ${short}? Start here: the basics explained simply, no overwhelm. Save this starter guide and tap through to learn more.`,
      visual: 'welcoming beginner desk setup, open guide, warm light',
    },
    'mistakes-to-avoid': {
      titleSuffix: 'Mistakes to Avoid',
      description: `Common mistakes people make with ${short.toLowerCase()} — and what to do instead. Save this so you do not learn the hard way.`,
      visual: 'subtle warning-sign accent in an organized scene, contrast lighting',
    },
    benefits: {
      titleSuffix: 'Why People Love It',
      description: `The practical benefits of ${short} at a glance: organized, reusable, and easy to start with. Save this roundup of highlights.`,
      visual: 'glowing highlights on a styled product scene, premium feel',
    },
    'use-case': {
      titleSuffix: 'Real-Life Use Cases',
      description: `Ways people actually use ${short} day to day — planning, organizing, and staying on track. Save your favorite idea.`,
      visual: 'lifestyle scene in use, hands organizing, cozy realism',
    },
  };
  return map[angle] || {
    titleSuffix: 'Ideas & Inspiration',
    description: `Ideas and inspiration around ${short}. A practical digital resource worth a look. Tap through to see details on Gumroad.`,
    visual: 'cozy styled scene, soft daylight',
  };
}

export async function generateSeoPack(
  product: { id: string; name: string; description: string | null; url: string },
  angle: string,
  knownKeywords: string[] = []
) {
  const prompt = seoPrompt({ name: product.name, description: product.description || '', url: product.url }, angle, knownKeywords);
  const fb = fallbackSeoForAngle(product, angle);
  const fallback = {
    title: sanitizeCopy(`${product.name.split('—')[0].trim().slice(0, 60)} — ${fb.titleSuffix}`.slice(0, 100)),
    description: sanitizeCopy(fb.description),
    primaryKeyword: keywordsFromName(product.name)[0] || product.name.split(' ')[0],
    secondaryKeywords: keywordsFromName(product.name).slice(1, 4),
    creativeAngle: angle,
    boardSuggestion: 'Digital Planning Ideas',
    imagePrompt: `Premium vertical Pinterest visual for ${product.name} (${angle} angle), ${fb.visual}, clean negative space on top for headline, no text in image, no watermarks.`,
    cta: process.env.BRAND_DEFAULT_CTA || 'Learn more',
    hashtags: [],
  };
  const r = await tryProvider<Record<string, unknown>>(prompt, fallback);
  const parsed = SeoPackSchema.safeParse({
    ...fallback,
    ...(r.data as Record<string, unknown>),
  });
  if (!parsed.success) throw new Error('AI SEO output failed validation: ' + parsed.error.message.slice(0, 400));
  const d = parsed.data;
  d.title = sanitizeCopy(d.title);
  d.description = sanitizeCopy(d.description);
  await prisma.aiGeneration.create({
    data: { kind: 'seo', productId: product.id, provider: r.provider, model: r.model, input: JSON.stringify({ angle }).slice(0, 1000), output: JSON.stringify(d).slice(0, 8000) },
  });
  return { ...d, provider: r.provider, model: r.model };
}
