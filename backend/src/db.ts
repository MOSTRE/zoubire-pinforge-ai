import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';

function ensureDirs(): void {
  for (const d of ['db', 'images', 'pins', 'logs', 'products']) {
    fs.mkdirSync(path.join(env.DATA_DIR, d), { recursive: true });
  }
}

ensureDirs();

export const prisma = new PrismaClient();

export async function getSetting(key: string, fallback = ''): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  if (!row) return process.env[key] ?? fallback;
  return row.value || (process.env[key] ?? fallback);
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = await getSetting(k, (process.env as Record<string, string | undefined>)[k] ?? '');
  return out;
}

export async function recordActivity(type: string, message: string, meta: Record<string, unknown> = {}): Promise<void> {
  try {
    await prisma.activityEvent.create({ data: { type, message, meta: JSON.stringify(meta).slice(0, 4000) } });
  } catch {
    // never fail main flow because of activity feed
  }
}
