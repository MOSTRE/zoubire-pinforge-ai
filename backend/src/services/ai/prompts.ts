export const CREATIVE_ANGLES = [
  'problem-solution',
  'educational',
  'checklist',
  'comparison',
  'productivity',
  'beginner-guide',
  'mistakes-to-avoid',
  'benefits',
  'use-case',
  'product-focused',
] as const;

export type CreativeAngle = (typeof CREATIVE_ANGLES)[number];

export function analysisPrompt(product: { name: string; description?: string; tags?: string[]; priceCents?: number | null }): string {
  return `You are a Pinterest SEO strategist for digital products. Analyze this Gumroad product conservatively. Do NOT invent features not supported by the data. When info is missing, phrase content conservatively.

Product name: ${product.name}
Description: ${(product.description || '').slice(0, 1500) || '(no description provided)'}
Tags: ${(product.tags || []).join(', ') || '(none)'}
Price cents: ${product.priceCents ?? '(unknown)'}

Return JSON with keys: category, targetAudience, buyerIntent, problemSolved, benefit, useCases (array), searchIntent, contentAngles (array), primaryKeywords (array), secondaryKeywords (array), longTailKeywords (array), relatedTopics (array), suggestedBoards (array), pinConcepts (array of 5).`;
}

export function seoPrompt(product: { name: string; description?: string; url: string }, angle: string, keywords: string[]): string {
  return `You are a Pinterest copywriter. Write natural, non-spammy Pinterest copy for this digital product. No keyword stuffing. Never claim guaranteed income/sales/transformation, fake testimonials, statistics, or reviews.

Product: ${product.name}
Description: ${(product.description || '').slice(0, 1000) || '(no description)'}
Destination URL: ${product.url}
Creative angle: ${angle}
Known keywords: ${keywords.join(', ') || '(discover from name)'}

Return JSON with keys: title (max 100 chars), description (2-4 sentences + soft CTA), primaryKeyword, secondaryKeywords (array of 3-6), creativeAngle ("${angle}"), boardSuggestion, imagePrompt (detailed visual prompt: subject, environment, lighting, vertical 2:3, negative space for text, premium digital-product ad style, no watermarks, no fake UI text), cta (short), hashtags (array of 0-5 like "#SmallBedroom").`;
}

export function imagePromptTemplate(productName: string, audience: string, mood: string, mainVisual: string): string {
  return `Create a premium Pinterest advertising visual for ${productName}. Show ${mainVisual}. Target audience: ${audience}. Mood: ${mood}. Style: modern commercial digital-product advertising. Composition: vertical 2:3. Leave clean negative space in the upper portion for headline typography. High visual clarity. Professional lighting. No watermarks. No fake UI text. No illegible text. No logos belonging to other brands.`;
}
