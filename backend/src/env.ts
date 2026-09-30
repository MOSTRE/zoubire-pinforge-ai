import path from 'node:path';
import { config as dotenvConfig } from 'dotenv';

const root = path.resolve(__dirname, '..', '..');
dotenvConfig({ path: path.join(root, '.env') });

// Honor the configured timezone for scheduler windows: Node interprets
// Date#setHours in server-local time, so aligning the process timezone makes
// SCHEDULER_START_TIME/END_TIME mean wall-clock time in APP_TIMEZONE.
if (process.env.APP_TIMEZONE && !process.env.TZ) {
  process.env.TZ = process.env.APP_TIMEZONE;
}

// Normalize DATABASE_URL so a relative file: URL always resolves against the
// repo root (same file the Prisma CLI wrapper targets). Prisma Client
// otherwise resolves relative SQLite paths against the cwd, which differs
// between `tsx src/index.ts`, `node dist/index.js`, and tests.
(function normalizeDatabaseUrl(): void {
  const raw = process.env.DATABASE_URL || '';
  if (!raw.startsWith('file:')) return;
  const p = raw.slice('file:'.length);
  const isAbs = path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p);
  if (!isAbs) {
    process.env.DATABASE_URL = `file:${path.resolve(root, p).replace(/\\/g, '/')}`;
  }
})();

function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}
function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v !== 0 ? v : (process.env[name] === '0' ? 0 : fallback);
}

export const env = {
  PORT: num('PORT', 3000),
  DATABASE_URL: str('DATABASE_URL', 'file:./data/db/dev.db'),
  GUMROAD_STORE_URL: str('GUMROAD_STORE_URL', 'https://zoubire.gumroad.com'),
  GUMROAD_API_TOKEN: str('GUMROAD_API_TOKEN', ''),
  OLLAMA_BASE_URL: str('OLLAMA_BASE_URL', 'http://127.0.0.1:11434'),
  OLLAMA_MODEL: str('OLLAMA_MODEL', 'llama3.1'),
  COMFYUI_URL: str('COMFYUI_URL', 'http://127.0.0.1:8188'),
  COMFYUI_WORKFLOW: str('COMFYUI_WORKFLOW', 'default'),
  PINTEREST_CLIENT_ID: str('PINTEREST_CLIENT_ID', ''),
  PINTEREST_CLIENT_SECRET: str('PINTEREST_CLIENT_SECRET', ''),
  PINTEREST_REDIRECT_URI: str('PINTEREST_REDIRECT_URI', 'http://localhost:3000/api/pinterest/oauth/callback'),
  PINTEREST_SCOPES: str('PINTEREST_SCOPES', 'boards:read boards:write pins:read pins:write'),
  APP_TIMEZONE: str('APP_TIMEZONE', 'Europe/Madrid'),
  SCHEDULER_START_TIME: str('SCHEDULER_START_TIME', '09:00'),
  SCHEDULER_END_TIME: str('SCHEDULER_END_TIME', '21:00'),
  SCHEDULER_PINS_PER_DAY: num('SCHEDULER_PINS_PER_DAY', 5),
  PUBLISHING_MODE: str('PUBLISHING_MODE', 'manual'),
  PINS_PER_DAY: num('PINS_PER_DAY', 5),
  MIN_INTERVAL_MINUTES: num('MIN_INTERVAL_MINUTES', 120),
  BRAND_NAME: str('BRAND_NAME', 'Zoubire'),
  BRAND_STORE_URL: str('BRAND_STORE_URL', 'https://zoubire.gumroad.com'),
  BRAND_DEFAULT_CTA: str('BRAND_DEFAULT_CTA', 'Shop now on Gumroad'),
  BRAND_FOOTER: str('BRAND_FOOTER', 'More practical tools on Gumroad'),
  DATA_DIR: path.join(root, 'data'),
  CONFIG_DIR: path.join(root, 'config'),
};

export const ROOT_DIR = root;
