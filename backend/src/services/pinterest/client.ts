import { z } from 'zod';
import { prisma, getSetting } from '../../db';
import { logger } from '../../logger';

const API = 'https://api.pinterest.com/v5';

/**
 * Local mirror of the official Pinterest v5 `PinCreate` schema
 * (verified against pinterest/api-description v5.28.0):
 * title ≤100, description ≤800, link ≤2048, alt_text ≤500,
 * board_id numeric string, media_source discriminated by source_type.
 */
export const PinImageBase64Schema = z.object({
  source_type: z.literal('image_base64'),
  content_type: z.enum(['image/jpeg', 'image/png']),
  data: z.string().regex(/^[a-zA-Z0-9+/=]+$/, 'data must be base64').min(100),
  is_standard: z.boolean().default(true),
});

export const PinCreatePayloadSchema = z.object({
  board_id: z.string().regex(/^\d+$/, 'board_id must be a numeric Pinterest board id'),
  title: z.string().min(1).max(100),
  description: z.string().max(800).default(''),
  link: z.string().max(2048).refine((u) => {
    try {
      const p = new URL(u);
      return p.protocol === 'http:' || p.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'link must be an http(s) URL'),
  alt_text: z.string().max(500).optional(),
  media_source: PinImageBase64Schema,
});

export type PinCreatePayload = z.infer<typeof PinCreatePayloadSchema>;

/** Pinterest v5 error body: {code, message}. */
export function parsePinterestError(status: number, bodyText: string): string {
  try {
    const j = JSON.parse(bodyText) as { code?: number; message?: string };
    if (typeof j.code === 'number' || typeof j.message === 'string') {
      return `Pinterest error ${status} (code ${j.code ?? '?'}): ${(j.message || 'unknown error').slice(0, 300)}`;
    }
  } catch {
    // fall through to raw text
  }
  return `Pinterest request failed (${status}): ${bodyText.slice(0, 300)}`;
}

export function oauthStartUrl(state: string): { url: string; missing: string[] } {
  const missing: string[] = [];
  const cid = process.env.PINTEREST_CLIENT_ID || '';
  const redirect = process.env.PINTEREST_REDIRECT_URI || '';
  const scopes = process.env.PINTEREST_SCOPES || 'boards:read boards:write pins:read pins:write';
  if (!cid) missing.push('PINTEREST_CLIENT_ID');
  if (!redirect) missing.push('PINTEREST_REDIRECT_URI');
  const url =
    `https://www.pinterest.com/oauth/?client_id=${encodeURIComponent(cid)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    `&response_type=code&scope=${encodeURIComponent(scopes.replace(/,/g, ' '))}` +
    `&state=${encodeURIComponent(state)}`;
  return { url, missing };
}

export async function exchangeCode(code: string): Promise<{
  access_token: string; refresh_token?: string; expires_in?: number;
  refresh_token_expires_in?: number; refresh_token_expires_at?: number; scope?: string;
}> {
  const cid = process.env.PINTEREST_CLIENT_ID || '';
  const secret = process.env.PINTEREST_CLIENT_SECRET || '';
  const redirect = process.env.PINTEREST_REDIRECT_URI || '';
  if (!cid || !secret) throw new Error('Pinterest app credentials missing (PINTEREST_CLIENT_ID / PINTEREST_CLIENT_SECRET)');
  const basic = Buffer.from(`${cid}:${secret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect });
  // Only apps created BEFORE 2025-09-25 need this flag to get a continuous
  // (60-day, indefinitely refreshable) refresh token. Newer apps get one
  // automatically and must ignore the parameter.
  if ((process.env.PINTEREST_CONTINUOUS_REFRESH || '').toLowerCase() === 'true') {
    body.set('continuous_refresh', 'true');
  }
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(parsePinterestError(res.status, (await res.text()).slice(0, 500)));
  return (await res.json()) as {
    access_token: string; refresh_token?: string; expires_in?: number;
    refresh_token_expires_in?: number; refresh_token_expires_at?: number; scope?: string;
  };
}

export async function persistTokenResponse(tok: {
  access_token: string; refresh_token?: string; expires_in?: number;
  refresh_token_expires_in?: number; refresh_token_expires_at?: number; scope?: string;
}): Promise<void> {
  const { setSetting } = await import('../../db');
  await setSetting('PINTEREST_ACCESS_TOKEN', tok.access_token);
  if (tok.refresh_token) await setSetting('PINTEREST_REFRESH_TOKEN', tok.refresh_token);
  if (tok.expires_in) await setSetting('PINTEREST_TOKEN_EXPIRES_AT', String(Date.now() + tok.expires_in * 1000));
  if (tok.refresh_token_expires_in) {
    await setSetting('PINTEREST_REFRESH_EXPIRES_IN', String(tok.refresh_token_expires_in));
    // Prefer the server-provided absolute timestamp when present.
    const abs = tok.refresh_token_expires_at
      ? String(tok.refresh_token_expires_at * 1000)
      : String(Date.now() + tok.refresh_token_expires_in * 1000);
    await setSetting('PINTEREST_REFRESH_EXPIRES_AT', abs);
  } else if (tok.refresh_token_expires_at) {
    await setSetting('PINTEREST_REFRESH_EXPIRES_AT', String(tok.refresh_token_expires_at * 1000));
  }
  if (tok.scope) await setSetting('PINTEREST_SCOPES_GRANTED', tok.scope);
}

export async function refreshAccessToken(): Promise<boolean> {
  const refresh = await getSetting('PINTEREST_REFRESH_TOKEN', '');
  if (!refresh) return false;
  const cid = process.env.PINTEREST_CLIENT_ID || '';
  const secret = process.env.PINTEREST_CLIENT_SECRET || '';
  if (!cid || !secret) return false;
  const basic = Buffer.from(`${cid}:${secret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh });
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    logger.warn('Pinterest refresh failed', { status: res.status });
    return false;
  }
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; refresh_token_expires_at?: number; scope?: string };
  if (j.access_token) {
    await persistTokenResponse({
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_in: j.expires_in,
      refresh_token_expires_in: j.refresh_token_expires_in,
      refresh_token_expires_at: j.refresh_token_expires_at,
      scope: j.scope,
    });
    return true;
  }
  return false;
}

async function token(): Promise<string | null> {
  const t = await getSetting('PINTEREST_ACCESS_TOKEN', '');
  return t || null;
}

/** Proactively refresh when the stored access-token expiry has passed (5 min skew). */
async function ensureFreshToken(): Promise<void> {
  const exp = Number(await getSetting('PINTEREST_TOKEN_EXPIRES_AT', '0'));
  if (exp && Date.now() > exp - 5 * 60 * 1000) {
    await refreshAccessToken().catch(() => false);
  }
}

async function api<T>(method: string, p: string, body?: unknown, retry = true): Promise<T> {
  await ensureFreshToken();
  let t = await token();
  if (!t) throw Object.assign(new Error('Pinterest not connected'), { statusCode: 401 });
  const exec = async (tok: string): Promise<Response> =>
    fetch(`${API}${p}`, {
      method,
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let res = await exec(t);
  if (res.status === 401 && retry) {
    const ok = await refreshAccessToken();
    if (ok) {
      t = (await token())!;
      res = await exec(t);
    }
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') || '0');
    const hint = Number.isFinite(retryAfter) && retryAfter > 0 ? ` Retry after ~${retryAfter}s.` : ' Slow down (org_write rate-limit category).';
    throw Object.assign(new Error(`Pinterest rate limit (429).${hint}`), {
      statusCode: 429,
      retryAfterSec: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    });
  }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 800);
    throw Object.assign(new Error(`Pinterest API ${method} ${p} failed — ${parsePinterestError(res.status, text)}`), { statusCode: res.status });
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface PinterestBoardDto {
  id: string; name: string; description?: string; privacy?: string;
}

export async function listBoards(): Promise<PinterestBoardDto[]> {
  const j = await api<{ items?: PinterestBoardDto[] }>('GET', '/boards?page_size=100');
  return j.items || [];
}

export async function createBoard(name: string, description = '', privacy = 'PUBLIC'): Promise<PinterestBoardDto> {
  const j = await api<PinterestBoardDto>('POST', '/boards', { name, description, privacy });
  try {
    await prisma.pinterestBoard.upsert({
      where: { pinterestId: j.id },
      create: { pinterestId: j.id, name: j.name, description: j.description || '', privacy: j.privacy || privacy },
      update: { name: j.name, description: j.description || '' },
    });
  } catch { /* ignore */ }
  return j;
}

/** Build a pins/create payload per the official v5 schema (verified vs spec v5.28.0).
 * Throws with a clear message when the input violates Pinterest's limits so
 * we fail fast locally instead of getting an API 400. */
export function buildPinPayload(input: {
  boardId: string;
  title: string;
  description: string;
  link: string;
  imageUrl?: string;
  imageBase64?: string;
  /** Defaults to image/jpeg (what the PinForge design engine outputs). */
  contentType?: 'image/jpeg' | 'image/png';
  altText?: string;
}): PinCreatePayload {
  if (!/^\d+$/.test(input.boardId || '')) {
    throw new Error('boardId must be a numeric Pinterest board id (spec pattern ^\\d+$)');
  }
  if (!input.title) throw new Error('title is required');
  if (!input.imageUrl && !input.imageBase64) throw new Error('An image (URL or upload) is required');
  if (input.imageBase64 && !/^[a-zA-Z0-9+/=]+$/.test(input.imageBase64.slice(0, 4000))) {
    throw new Error('imageBase64 must be base64-encoded image data');
  }
  let link: string;
  try {
    const u = new URL(input.link);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
    link = input.link.slice(0, 2048);
  } catch {
    throw new Error('link must be a valid http(s) destination URL (max 2048 chars)');
  }
  const media_source = input.imageBase64
    ? { source_type: 'image_base64' as const, content_type: (input.contentType || 'image/jpeg') as 'image/jpeg' | 'image/png', data: input.imageBase64, is_standard: true as const }
    : { source_type: 'image_url' as const, url: input.imageUrl as string, is_standard: true as const };
  const payload = {
    board_id: input.boardId,
    title: input.title.slice(0, 100),
    description: (input.description || '').slice(0, 800),
    link,
    alt_text: (input.altText || input.title).slice(0, 500),
    media_source,
  };
  const parsed = PinCreatePayloadSchema.safeParse(payload);
  if (!parsed.success) throw new Error(`Pin payload violates Pinterest schema: ${parsed.error.message.slice(0, 400)}`);
  return parsed.data;
}

export async function createPin(payload: PinCreatePayload): Promise<{ id: string; [k: string]: unknown }> {
  // Spec returns 200 or 201 with the created Pin (incl. id); api() accepts both.
  return api('POST', '/pins', payload);
}

/** Live pins/list (page_size=1) — used to verify the pins:read scope without side effects. */
export async function listPins(pageSize = 1): Promise<Array<{ id: string; [k: string]: unknown }>> {
  const j = await api<{ items?: Array<{ id: string; [k: string]: unknown }> }>(
    'GET',
    `/pins?page_size=${Math.min(25, Math.max(1, pageSize))}`
  );
  return j.items || [];
}

export async function getPin(pinId: string): Promise<Record<string, unknown>> {
  return api('GET', `/pins/${encodeURIComponent(pinId)}`);
}

export async function connectionStatus(): Promise<{ connected: boolean; detail: string; scopes?: string }> {
  const t = await token();
  if (!t) return { connected: false, detail: 'Not connected — add app credentials in Settings → Pinterest, then Connect.' };
  try {
    const me = await api<{ username?: string }>('GET', '/user_account');
    const scopes = await getSetting('PINTEREST_SCOPES_GRANTED', process.env.PINTEREST_SCOPES || '');
    return { connected: true, detail: `Connected${me.username ? ` as @${me.username}` : ''}`, scopes };
  } catch (e) {
    return { connected: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
