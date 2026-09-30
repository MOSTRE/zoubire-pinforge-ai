// Loads the repo-root .env (../.env) then runs the given command.
// Needed because Prisma CLI looks for .env next to the workspace package,
// while PinForge keeps a single .env at the repo root.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let dotenv;
try {
  dotenv = require('dotenv');
} catch {
  // dotenv lives in backend/node_modules; fall back to root if hoisted
  dotenv = require(path.join(__dirname, '..', '..', 'node_modules', 'dotenv'));
}
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

// Normalize DATABASE_URL: treat a relative file: URL as relative to the
// repo root so CLI and runtime always open the same SQLite file.
const ROOT = path.join(__dirname, '..', '..');
const raw = process.env.DATABASE_URL || '';
if (raw.startsWith('file:')) {
  const p = raw.slice('file:'.length);
  const isAbs = path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p);
  if (!isAbs) {
    const abs = path.resolve(ROOT, p).replace(/\\/g, '/');
    process.env.DATABASE_URL = `file:${abs}`;
  }
}

const [, , ...args] = process.argv;
if (!args.length) {
  console.error('Usage: run-with-env.cjs <cmd> [args...]');
  process.exit(2);
}
// Make workspace binaries (prisma, tsx, ...) resolvable without npm's PATH.
const binDir = path.join(__dirname, '..', 'node_modules', '.bin');
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ''}`;
const res = spawnSync(args[0], args.slice(1), {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  cwd: path.join(__dirname, '..'),
});
process.exit(res.status ?? 1);
