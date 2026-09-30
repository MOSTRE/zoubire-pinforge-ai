import { logger } from '../logger';

export interface GumroadProduct {
  gumroadId?: string;
  permalink?: string;
  name: string;
  url: string;
  description?: string;
  thumbnailUrl?: string;
  priceCents?: number | null;
  currency?: string;
  tags?: string[];
}

export interface GumroadFetchResult {
  ok: boolean;
  products: GumroadProduct[];
  method: string;
  error?: string;
  total?: number;
}

function cleanUrl(u: string, storeUrl: string): string {
  try {
    const base = new URL(storeUrl);
    if (u.startsWith('/')) return `${base.origin}${u}`;
    return u;
  } catch {
    return u;
  }
}

function canonicalProductUrl(raw: string, storeUrl: string): string {
  let u = cleanUrl(raw, storeUrl).split('?')[0].replace(/\/$/, '');
  return u;
}

/** Parse Inertia data-page JSON embedded in Gumroad profile HTML (current Gumroad architecture). */
export function parseGumroadCatalogHtml(html: string, storeUrl: string): GumroadProduct[] {
  const out: GumroadProduct[] = [];

  // 1) Inertia #app data-page JSON
  const appMatch = html.match(/<div id="app"[^>]*data-page="([^"]+)"/) || html.match(/data-page="(\{&quot;.*?\})"/s);
  let dataPageRaw: string | null = null;
  if (appMatch) {
    dataPageRaw = appMatch[1];
  } else {
    // fallback: look for data-page='{...}' single quotes
    const m2 = html.match(/data-page='(\{.*?\})'/s);
    if (m2) dataPageRaw = m2[1];
  }
  if (dataPageRaw) {
    try {
      const decoded = dataPageRaw
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#x27;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\\u0026/g, '&');
      const page = JSON.parse(decoded) as {
        props?: {
          sections?: Array<{
            search_results?: {
              products?: Array<{
                id?: string;
                permalink?: string;
                name?: string;
                url?: string;
                thumbnail_url?: string;
                price_cents?: number;
                currency_code?: string;
              }>;
            };
          }>;
        };
      };
      const sections = page?.props?.sections ?? [];
      for (const s of sections) {
        for (const p of s?.search_results?.products ?? []) {
          if (!p.name || !p.url) continue;
          const url = canonicalProductUrl(p.url, storeUrl);
          out.push({
            gumroadId: p.id,
            permalink: p.permalink,
            name: p.name.trim(),
            url,
            thumbnailUrl: p.thumbnail_url,
            priceCents: typeof p.price_cents === 'number' ? p.price_cents : null,
            currency: p.currency_code || 'usd',
            tags: [],
          });
        }
      }
      if (out.length) return dedupe(out);
    } catch (e) {
      logger.warn('Inertia data-page parse failed', { error: String(e).slice(0, 300) });
    }
  }

  // 2) Legacy gumroad-data catalog block
  const gumroadData = html.match(/<script[^>]*id="gumroad-data"[^>]*>([\s\S]*?)<\/script>/i);
  if (gumroadData) {
    try {
      const parsed = JSON.parse(gumroadData[1]) as { products?: GumroadProduct[] };
      if (Array.isArray(parsed.products)) {
        for (const p of parsed.products) {
          if (!p.name || !p.url) continue;
          out.push({ ...p, url: canonicalProductUrl(String(p.url), storeUrl) });
        }
        if (out.length) return dedupe(out);
      }
    } catch { /* continue */ }
  }

  // 3) Generic fallback: OG meta + product anchors (/l/ links)
  const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1];
  void ogTitle;
  const anchors = [...html.matchAll(/<a[^>]+href="([^"]*\/l\/[^"]+)"[^>]*>([\s\S]{0,400}?)<\/a>/gi)];
  const seen = new Set<string>();
  for (const a of anchors) {
    const href = cleanUrl(a[1], storeUrl).split('?')[0];
    if (seen.has(href)) continue;
    seen.add(href);
    const text = a[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) continue;
    if (/follow|subscribe|share|login/i.test(text) && text.length < 20) continue;
    out.push({ name: text, url: canonicalProductUrl(href, storeUrl) });
  }
  return dedupe(out);
}

export function dedupe(products: GumroadProduct[]): GumroadProduct[] {
  const seen = new Set<string>();
  const out: GumroadProduct[] = [];
  for (const p of products) {
    const key = (p.gumroadId || '') + '|' + canonicalKey(p.url) + '|' + (p.permalink || '');
    if (seen.has(key)) continue;
    // also dedupe by bare URL
    const urlKey = 'url|' + canonicalKey(p.url);
    if (seen.has(urlKey)) continue;
    seen.add(key);
    seen.add(urlKey);
    out.push(p);
  }
  return out;
}

function canonicalKey(url: string): string {
  return url.toLowerCase().split('?')[0].replace(/\/$/, '');
}

/** Fetch a single Gumroad product page and enrich description/tags/image. Best-effort. */
export async function enrichProductFromPage(url: string, timeoutMs = 15000): Promise<Partial<GumroadProduct>> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'PinForgeAI/1.0 (+local)' },
    });
    clearTimeout(t);
    if (!res.ok) return {};
    const html = await res.text();
    const desc =
      html.match(/<meta[^>]+name="description"[^>]+content="([^"]{10,2000})"/i)?.[1] ||
      html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]{10,2000})"/i)?.[1] ||
      '';
    const img =
      html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1] || undefined;
    const tagMatches = [...html.matchAll(/<a[^>]+href="[^"]*tag[^"]*"[^>]*>([^<]{1,60})<\/a>/gi)]
      .map((m) => m[1].trim())
      .filter(Boolean)
      .slice(0, 10);
    return {
      description: decodeHtml(desc).slice(0, 4000),
      thumbnailUrl: img,
      tags: tagMatches.length ? [...new Set(tagMatches)] : undefined,
    };
  } catch {
    return {};
  }
}

function decodeHtml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

export async function fetchGumroadCatalog(storeUrl: string, timeoutMs = 20000): Promise<GumroadFetchResult> {
  const normalized = storeUrl.replace(/\/$/, '');
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(normalized, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'PinForgeAI/1.0 (+local)', Accept: 'text/html' },
    });
    clearTimeout(t);
    if (!res.ok) {
      return { ok: false, products: [], method: 'http', error: `Gumroad responded with HTTP ${res.status}` };
    }
    const html = await res.text();
    const products = parseGumroadCatalogHtml(html, normalized);
    if (!products.length) {
      return {
        ok: false,
        products: [],
        method: 'catalog-parse',
        error: 'Catalog block not found: Gumroad changed markup or store has no public products. Use CSV/manual import.',
      };
    }
    return { ok: true, products, method: 'inertia-catalog', total: products.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, products: [], method: 'http', error: `Could not reach Gumroad store: ${msg}` };
  }
}

/** Parse CSV: expects header with at least name,url (also supports description,thumbnailUrl,priceCents,tags). */
export function parseProductCsv(csv: string): GumroadProduct[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (n: string) => headers.indexOf(n);
  const iName = idx('name');
  const iUrl = idx('url');
  if (iName < 0 || iUrl < 0) throw new Error('CSV must contain "name" and "url" columns');
  const out: GumroadProduct[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const name = (cols[iName] || '').trim();
    const url = (cols[iUrl] || '').trim();
    if (!name || !url) continue;
    const g: GumroadProduct = { name, url };
    const gi = (n: string) => {
      const j = idx(n);
      return j >= 0 ? (cols[j] || '').trim() : '';
    };
    const desc = gi('description');
    if (desc) g.description = desc;
    const thumb = gi('thumbnailurl') || gi('thumbnail_url') || gi('image');
    if (thumb) g.thumbnailUrl = thumb;
    const price = gi('pricecents') || gi('price_cents') || gi('price');
    if (price) {
      const n = Number(price.replace(/[^0-9.]/g, ''));
      if (Number.isFinite(n)) g.priceCents = Math.round(n * (n < 1000 && price.includes('.') ? 100 : 1));
    }
    const tags = gi('tags');
    if (tags) g.tags = tags.split(/[;|]/).map((t) => t.trim()).filter(Boolean);
    const perm = gi('permalink');
    if (perm) g.permalink = perm;
    out.push(g);
  }
  return dedupe(out);
}

function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      cols.push(cur); cur = '';
    } else cur += c;
  }
  cols.push(cur);
  return cols.map((c) => c.trim().replace(/^"|"$/g, ''));
}
