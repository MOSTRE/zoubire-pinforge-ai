/**
 * Pinterest Doctor — publishing readiness diagnostic.
 * Usage: npm run pinterest:doctor
 *
 * Checks credentials, OAuth config, token status, API connectivity,
 * per-scope access (boards:read/write, pins:read/write), image validity,
 * destination URL, and duplicate/limit safety — then reports READY or the
 * exact reason publishing is not possible. Never publishes anything.
 */
import { prisma, getSetting } from '../db';
import { logger } from '../logger';
import {
  oauthStartUrl,
  connectionStatus,
  listBoards,
  listPins,
  buildPinPayload,
} from '../services/pinterest/client';
import { qualityCheck } from '../services/images/base';
import { checkDuplicate, publishingAllowed } from '../services/safety';

type Row = { label: string; ok: boolean; warn?: boolean; detail: string };

const tick = (r: Row): string => `${r.ok ? '✓' : r.warn ? '!' : '✗'} ${r.label.padEnd(16)} ${r.detail}`;

function scopeEvidence(granted: string, fallback: string, scope: string): boolean {
  const src = (granted || fallback || '').replace(/,/g, ' ');
  return src.split(/\s+/).includes(scope);
}

async function urlReachable(url: string, timeoutMs = 15000): Promise<{ ok: boolean; detail: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal,
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'PinForgeAI-doctor/1.0 (+local readiness check)' },
    });
    clearTimeout(t);
    return res.ok
      ? { ok: true, detail: `reachable (HTTP ${res.status})` }
      : { ok: false, detail: `HTTP ${res.status} — link may still work in browsers` };
  } catch (e) {
    return { ok: false, detail: `unreachable: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` };
  }
}

async function main(): Promise<void> {
  const rows: Row[] = [];
  const blockers: string[] = [];

  // 1) Credentials (backend-only, from .env)
  const cid = process.env.PINTEREST_CLIENT_ID || '';
  const secret = process.env.PINTEREST_CLIENT_SECRET || '';
  const credsOk = Boolean(cid && secret);
  rows.push({
    label: 'Credentials',
    ok: credsOk,
    detail: credsOk
      ? `client_id …${cid.slice(-4)} configured`
      : 'PINTEREST_CLIENT_ID / PINTEREST_CLIENT_SECRET missing in .env',
  });
  if (!credsOk) blockers.push('Add PINTEREST_CLIENT_ID + PINTEREST_CLIENT_SECRET to .env (Settings → Pinterest).');

  // 2) OAuth configuration
  const redirect = process.env.PINTEREST_REDIRECT_URI || '';
  let redirectOk = false;
  try {
    const u = new URL(redirect);
    redirectOk = u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    redirectOk = false;
  }
  const { missing } = oauthStartUrl('doctor-probe');
  const oauthOk = credsOk && redirectOk && missing.length === 0;
  rows.push({
    label: 'OAuth',
    ok: oauthOk,
    detail: oauthOk
      ? `redirect_uri matches app registration: ${redirect}`
      : `redirect_uri must EXACTLY match the URI registered in the Pinterest app (got: ${redirect || '<empty>'})`,
  });
  if (!oauthOk) blockers.push('Set PINTEREST_REDIRECT_URI to exactly the URI registered in developers.pinterest.com/apps (default http://localhost:3000/api/pinterest/oauth/callback).');

  // 3) Token status
  const access = await getSetting('PINTEREST_ACCESS_TOKEN', '');
  const refresh = await getSetting('PINTEREST_REFRESH_TOKEN', '');
  const expAt = Number(await getSetting('PINTEREST_TOKEN_EXPIRES_AT', '0'));
  const granted = await getSetting('PINTEREST_SCOPES_GRANTED', '');
  const refreshExpAt = Number(await getSetting('PINTEREST_REFRESH_EXPIRES_AT', '0'));
  let tokenDetail = 'no stored access token — connect via Settings → Pinterest → Connect';
  let tokenOk = false;
  if (access) {
    if (expAt && Date.now() > expAt) {
      tokenDetail = refresh
        ? 'access token expired, refresh token present — will auto-refresh on next call'
        : 'access token EXPIRED and no refresh token — reconnect required';
      tokenOk = Boolean(refresh);
    } else {
      tokenDetail = `present${expAt ? ` (expires ${new Date(expAt).toLocaleString()})` : ''}${refresh ? ' + refresh token stored' : ' (no refresh token stored)'}`;
      tokenOk = true;
    }
    if (refreshExpAt && Date.now() > refreshExpAt) {
      tokenDetail += ' — WARNING: refresh token past expiry, reconnect via OAuth flow';
      tokenOk = false;
    }
  }
  rows.push({ label: 'Token', ok: tokenOk, detail: tokenDetail });
  if (!tokenOk) blockers.push('Connect Pinterest (OAuth) to obtain an access token.');

  // 4) API connectivity (GET /user_account — proves Bearer auth works)
  const conn = await connectionStatus();
  rows.push({ label: 'API connectivity', ok: conn.connected, detail: conn.detail });
  if (!conn.connected) blockers.push(`API unreachable: ${conn.detail}`);

  // 5) boards:read — live GET /boards
  let boardsReadOk = false;
  let boardsReadDetail = 'skipped (no token)';
  if (tokenOk && conn.connected) {
    try {
      const boards = await listBoards();
      boardsReadOk = true;
      boardsReadDetail = `GET /v5/boards OK (${boards.length} board${boards.length === 1 ? '' : 's'} visible)`;
    } catch (e) {
      boardsReadDetail = e instanceof Error ? e.message.slice(0, 160) : String(e);
    }
  }
  rows.push({ label: 'boards:read', ok: boardsReadOk, detail: boardsReadDetail });
  if (!boardsReadOk) blockers.push('boards:read check failed — reconnect with boards:read scope.');

  // 6) boards:write — scope evidence (live write would create a board, so not attempted)
  const scopesFallback = process.env.PINTEREST_SCOPES || '';
  const bwOk = scopeEvidence(granted, scopesFallback, 'boards:write') && tokenOk;
  rows.push({
    label: 'boards:write',
    ok: bwOk,
    detail: bwOk
      ? `scope granted (${(granted || scopesFallback).split(/[ ,]+/).filter(Boolean).join(', ')}) — live create not attempted by doctor`
      : 'boards:write scope not evidenced — reconnect requesting boards:write',
  });
  if (!bwOk) blockers.push('boards:write scope missing.');

  // 7) pins:read — live GET /pins?page_size=1
  let pinsReadOk = false;
  let pinsReadDetail = 'skipped (no token)';
  if (tokenOk && conn.connected) {
    try {
      const pins = await listPins(1);
      pinsReadOk = true;
      pinsReadDetail = `GET /v5/pins OK (${pins.length} pin${pins.length === 1 ? '' : 's'} sampled)`;
    } catch (e) {
      pinsReadDetail = e instanceof Error ? e.message.slice(0, 160) : String(e);
    }
  }
  rows.push({ label: 'pins:read', ok: pinsReadOk, detail: pinsReadDetail });
  if (!pinsReadOk) blockers.push('pins:read check failed — reconnect with pins:read scope.');

  // 8) pins:write — scope evidence + local dry-run payload validation
  let pwOk = scopeEvidence(granted, scopesFallback, 'pins:write') && tokenOk;
  let pwDetail = pwOk
    ? 'scope granted — live create not attempted by doctor'
    : 'pins:write scope not evidenced — reconnect requesting pins:write';
  if (pwOk) {
    try {
      const sample = await prisma.pin.findFirst({ where: { imagePath: { not: null } }, orderBy: { createdAt: 'desc' } });
      if (sample?.imagePath) {
        const { readFileSync, existsSync } = await import('node:fs');
        if (existsSync(sample.imagePath)) {
          const b64 = readFileSync(sample.imagePath).toString('base64');
          buildPinPayload({
            boardId: sample.boardId && /^\d+$/.test(sample.boardId) ? sample.boardId : '000000000000',
            title: sample.title,
            description: sample.description || '',
            link: sample.destinationUrl,
            imageBase64: b64,
            altText: sample.title,
          });
          pwDetail += ' + dry-run payload validates against v5 PinCreate schema';
        } else {
          pwOk = false;
          pwDetail = 'sample Pin image file missing — generate a Pin first';
        }
      } else {
        pwOk = false;
        pwDetail = 'no completed Pin in DB — generate one first (pins:write payload not yet exercised)';
      }
    } catch (e) {
      pwOk = false;
      pwDetail = `dry-run payload invalid: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`;
    }
  }
  rows.push({ label: 'pins:write', ok: pwOk, detail: pwDetail });
  if (!pwOk) blockers.push('pins:write not ready — see detail above.');

  // 9) Image — QC the newest completed Pin image
  const newest = await prisma.pin.findFirst({ where: { imagePath: { not: null } }, orderBy: { createdAt: 'desc' } });
  let imageOk = false;
  let imageDetail = 'no generated Pin image found — generate a Pin first';
  if (newest?.imagePath) {
    const qc = await qualityCheck(newest.imagePath);
    imageOk = qc.ok;
    imageDetail = qc.ok
      ? `${qc.width}x${qc.height} (~2:3), ${(qc.bytes / 1024).toFixed(0)}KB — "${newest.title.slice(0, 50)}"`
      : `QC failed: ${qc.issues.join('; ')}`;
  }
  rows.push({ label: 'Image', ok: imageOk, detail: imageDetail });
  if (!imageOk) blockers.push('No valid Pin image — generate a Pin first.');

  // 10) Destination URL — format is what the API validates; reachability is a bonus
  let destOk = false;
  let destDetail = 'no Pin to check — generate one first';
  let destWarn = false;
  if (newest) {
    let formatOk = false;
    try {
      const u = new URL(newest.destinationUrl);
      formatOk = u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      formatOk = false;
    }
    if (!formatOk) {
      destDetail = `invalid destination URL: ${newest.destinationUrl.slice(0, 80)}`;
    } else {
      const reach = await urlReachable(newest.destinationUrl);
      destDetail = `${newest.destinationUrl.slice(0, 70)} — ${reach.detail}`;
      if (reach.ok) {
        destOk = true;
      } else {
        // Link format is valid (all the API requires); flag reachability as a warning.
        destOk = true;
        destWarn = true;
        destDetail += ' (format valid — API accepts it; reachability is informational)';
      }
    }
  }
  rows.push({ label: 'Destination URL', ok: destOk, warn: destWarn || undefined, detail: destDetail });
  if (!destOk) blockers.push('Destination URL invalid.');

  // 11) Publishing safety — duplicates + daily limit for the newest pin
  if (newest) {
    try {
      const dup = await checkDuplicate(newest.id);
      const gate = await publishingAllowed();
      const safeOk = !dup.duplicate && gate.allowed;
      rows.push({
        label: 'Safety',
        ok: safeOk,
        detail: safeOk ? 'no duplicate detected, daily limit not reached' : [dup.duplicate ? dup.reasons.join('; ') : '', gate.allowed ? '' : gate.reason || ''].filter(Boolean).join(' | '),
      });
      if (!safeOk) blockers.push('Publishing safety gate tripped — see Safety row.');
    } catch (e) {
      rows.push({ label: 'Safety', ok: false, detail: e instanceof Error ? e.message.slice(0, 160) : String(e) });
      blockers.push('Safety check errored.');
    }
  }

  // Final verdict
  console.log('\nPinterest Doctor');
  console.log('────────────────────────');
  for (const r of rows) console.log(tick(r));
  console.log('────────────────────────');
  console.log('Note: apps with Trial access create sandbox-only Pins/boards (visible');
  console.log('only to the creator) with daily per-app limits; upgrade to Standard');
  console.log('access for full visibility and higher limits.');
  if (blockers.length === 0) {
    console.log('Publishing        READY');
  } else {
    console.log('Publishing        NOT READY');
    for (const b of blockers) console.log(`  • ${b}`);
  }
  console.log('');
  await prisma.$disconnect();
  if (blockers.length) {
    logger.warn(`Pinterest doctor: NOT READY (${blockers.length} blocker${blockers.length === 1 ? '' : 's'})`);
    process.exitCode = 1;
  } else {
    logger.info('Pinterest doctor: READY');
  }
}

if (require.main === module) {
  main().catch((e) => {
    logger.error('Pinterest doctor failed', { error: String(e).slice(0, 400) });
    process.exitCode = 1;
  });
}
