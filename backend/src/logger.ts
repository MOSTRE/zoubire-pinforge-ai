import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function logDir(): string {
  const d = path.join(env.DATA_DIR, 'logs');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function line(level: LogLevel, msg: string, meta?: unknown): string {
  const ts = new Date().toISOString();
  const extra = meta === undefined ? '' : ` ${safe(meta)}`;
  return `[${ts}] [${level.toUpperCase()}] ${msg}${extra}`;
}

function safe(v: unknown): string {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return redact(s);
  } catch {
    return '[unserializable]';
  }
}

// Never log secrets
export function redact(s: string): string {
  return s
    .replace(/(client_secret["'=: ]+)([^"',\s&}]+)/gi, '$1***')
    .replace(/(access_token["'=: ]+)([^"',\s&}]+)/gi, '$1***')
    .replace(/(refresh_token["'=: ]+)([^"',\s&}]+)/gi, '$1***')
    .replace(/(Bearer\s+)([A-Za-z0-9\-._~+/=]+)/g, '$1***')
    .replace(/(Basic\s+)([A-Za-z0-9+/=]+)/g, '$1***');
}

export function log(level: LogLevel, msg: string, meta?: unknown): void {
  const text = line(level, msg, meta);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
  try {
    const file = path.join(logDir(), `${new Date().toISOString().slice(0, 10)}.log`);
    fs.appendFileSync(file, text + '\n');
  } catch {
    // logging must never crash the app
  }
}

export const logger = {
  info: (m: string, meta?: unknown) => log('info', m, meta),
  warn: (m: string, meta?: unknown) => log('warn', m, meta),
  error: (m: string, meta?: unknown) => log('error', m, meta),
  debug: (m: string, meta?: unknown) => log('debug', m, meta),
};
