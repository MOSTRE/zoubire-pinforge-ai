import { z } from 'zod';

export const ProductInputSchema = z.object({
  name: z.string().min(1).max(300),
  url: z.string().url().max(2000),
  description: z.string().max(20000).optional().default(''),
  thumbnailUrl: z.string().max(2000).optional().nullable(),
  priceCents: z.number().int().min(0).nullable().optional(),
  currency: z.string().max(10).optional().default('usd'),
  tags: z.array(z.string().max(80)).optional().default([]),
  permalink: z.string().max(200).optional().nullable(),
  gumroadId: z.string().max(200).optional().nullable(),
});

export const PinGenerateSchema = z.object({
  productId: z.string().min(1),
  count: z.number().int().min(1).max(10).default(1),
  creativeAngles: z.array(z.string().max(60)).optional(),
  template: z.string().max(60).optional(),
  boardId: z.string().max(200).optional().nullable(),
  boardName: z.string().max(200).optional().nullable(),
});

export const PinUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  primaryKeyword: z.string().max(120).optional(),
  secondaryKeywords: z.array(z.string().max(80)).optional(),
  hashtags: z.array(z.string().max(60)).optional(),
  cta: z.string().max(200).optional(),
  destinationUrl: z.string().url().max(2000).optional(),
  boardId: z.string().max(200).optional().nullable(),
  boardName: z.string().max(200).optional().nullable(),
  template: z.string().max(60).optional(),
  status: z.enum(['draft', 'approved', 'scheduled', 'publishing', 'published', 'failed']).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});

export const ScheduleSchema = z.object({
  pinId: z.string().min(1),
  scheduledAt: z.string().datetime(),
});

export const BoardCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(800).optional().default(''),
  // Spec enum: PUBLIC | PROTECTED | SECRET (secret boards may need extra scopes).
  privacy: z.enum(['PUBLIC', 'PROTECTED', 'SECRET']).optional().default('PUBLIC'),
});

export const SettingsSchema = z.record(z.string(), z.string());

export const AnalysisSchema = z.object({
  category: z.string().max(200),
  targetAudience: z.string().max(1000),
  buyerIntent: z.string().max(1000),
  problemSolved: z.string().max(1500),
  benefit: z.string().max(1500),
  useCases: z.array(z.string().max(300)).default([]),
  searchIntent: z.string().max(1000),
  contentAngles: z.array(z.string().max(120)).default([]),
  primaryKeywords: z.array(z.string().max(80)).default([]),
  secondaryKeywords: z.array(z.string().max(80)).default([]),
  longTailKeywords: z.array(z.string().max(120)).default([]),
  relatedTopics: z.array(z.string().max(120)).default([]),
  suggestedBoards: z.array(z.string().max(120)).default([]),
  pinConcepts: z.array(z.string().max(300)).default([]),
});

export const SeoPackSchema = z.object({
  title: z.string().min(5).max(150),
  description: z.string().min(20).max(2000),
  primaryKeyword: z.string().min(2).max(120),
  secondaryKeywords: z.array(z.string().max(80)).default([]),
  creativeAngle: z.string().max(80).default('product-focused'),
  boardSuggestion: z.string().max(120).default(''),
  imagePrompt: z.string().min(20).max(4000),
  cta: z.string().max(200).default(''),
  hashtags: z.array(z.string().max(60)).default([]),
});

export function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    // try to extract first {...} block (LLM often wraps in prose)
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as T;
    } catch {
      return null;
    }
  }
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'product';
}
