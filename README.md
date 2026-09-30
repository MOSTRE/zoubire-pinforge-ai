# PinForge AI

Local-first desktop/web app that turns your **Gumroad products** into high-quality **Pinterest Pins**: AI SEO copy, AI image prompts, local image generation + Sharp typography composition, approval queue, scheduler, and publishing through the official Pinterest API.

Store: https://zoubire.gumroad.com

## What it does

```
Gumroad store → discover products → AI analysis → SEO strategy → image prompt
→ image generation → Sharp design overlay → title/description/keywords
→ board → queue → approval → Pinterest API publish → DB status
```

- **Free-first, local:** Ollama (text), ComfyUI or built-in renderer (images), SQLite + Prisma, Sharp, node-cron. No paid SaaS required.
- **Provider abstractions:** swap LLM or image backends without touching the pipeline.
- **Safety:** daily limits, min interval, fingerprint + hash + title-similarity duplicate guard, manual approval by default.

## Requirements

- Node.js 18+ (tested on Node 24), npm
- Windows / macOS / Linux (Windows-first paths handled)
- Optional: [Ollama](https://ollama.com) + a model (`ollama pull llama3.1`)
- Optional: [ComfyUI](https://github.com/comfyanonymous/ComfyUI) running at `http://127.0.0.1:8188`
- Pinterest developer app (only needed for real publishing)

## Quick start (Windows PowerShell)

```powershell
# 1) Install
npm install
Copy-Item .env.example .env

# 2) Database (SQLite via Prisma)
npm run db:migrate

# 3) Dev (backend :3000 serves API; frontend :5173 with proxy)
npm run dev          # backend (http://localhost:3000)
npm run dev:frontend # in a second terminal (http://localhost:5173)

# 4) Production build + run (backend serves frontend dist)
npm run build
npm run start        # http://localhost:3000
```

Useful:

```powershell
npm run test
npm run lint
npm run db:studio
npm run sync    # CLI Gumroad sync
npm run worker  # run one scheduler tick
```

## Setup wizard

First launch shows a 6-step wizard: Gumroad URL → Ollama → image generator → Pinterest → publishing mode → sync. All settings remain editable in **Settings**.

## Integrations

### 1. Gumroad importer
- `POST /api/products/sync` fetches `GUMROAD_STORE_URL`, parses the Inertia `data-page` catalog JSON (current Gumroad architecture), falls back to legacy blocks/anchors, then CSV/manual.
- Sync summary: `found / new / updated / unchanged`; missing products marked `removed`.
- Verified against https://zoubire.gumroad.com (4 products at time of writing).
- Fallback: Products page → CSV import (`name,url,description,thumbnailUrl,priceCents,tags`).

### 2. Ollama (local LLM)
- `OLLAMA_BASE_URL`, `OLLAMA_MODEL` in `.env`; model picker in Settings → AI (lists `/api/tags`).
- Abstraction in `backend/src/services/ai/` — add another provider by implementing `AiProvider`.
- If Ollama is offline, a conservative heuristic fallback generates non-fabricated copy so the app never crashes.
- All AI output validated with Zod; malformed output is rejected, never saved.

### 3. Images
- `GET /api/images/providers/status` shows ComfyUI vs built-in renderer.
- ComfyUI: configurable workflow JSON in `config/comfyui/` (`COMFYUI_URL`, `COMFYUI_WORKFLOW`). Submit → poll `/history` → download → save locally.
- Built-in `local-synthetic` renderer (Sharp/SVG) always works — app never depends on one provider.
- Design engine (`services/images/design.ts`): 7 templates, headline/subtitle/CTA/brand overlay with Sharp — image models never render complex text.
- QC checks dimensions, ratio (~2:3), format, size, readability; failures offer regeneration.

### 4. Pinterest (official API v5)
### 4. Pinterest (official API v5 — audited 2026-09-30 against spec v5.28.0)

Docs used: authentication/authorization + boards-and-pins guides + access-tiers
(Authorization Code grant, `boards:read boards:write pins:read pins:write`).
Schema verified line-by-line against the official OpenAPI description
(`pinterest/api-description` v5.28.0, schemas `PinCreate`,
`PinMediaSourceImageBase64`, `BoardCreate`, `OauthAccessTokenCreate`).

1. Create app at https://developers.pinterest.com/apps/
2. Redirect URI: `http://localhost:3000/api/pinterest/oauth/callback` (must match exactly)
3. Put ID/secret in `.env` → Settings → Pinterest → **Connect Pinterest**
4. Scopes requested: `boards:read boards:write pins:read pins:write`
5. Tokens stored backend-only in SQLite (`Setting`: access, refresh,
   `PINTEREST_TOKEN_EXPIRES_AT`, `PINTEREST_REFRESH_EXPIRES_AT`, granted scopes);
   proactive refresh before expiry + retry on 401; secrets never sent to the browser.
   Apps created **before 2025-09-25** set `PINTEREST_CONTINUOUS_REFRESH="true"` to
   get a continuous (60-day, indefinitely refreshable) token; newer apps get one
   automatically. Legacy 365-day tokens are no longer supported by Pinterest.
6. Publishing uses `POST /v5/pins` with `media_source: {source_type: "image_base64",
   content_type: "image/jpeg"|"image/png" (detected from the actual file),
   data: <base64>, is_standard: true}` — verified against the spec, not assumed —
   plus `board_id` (numeric, validated locally), `title` (≤100), `description`
   (≤800), `link` (= Gumroad URL, validated http(s), ≤2048), `alt_text` (≤500).
   Success is 200/201 with the created Pin `id`; errors are parsed from Pinterest's
   `{code, message}` body; 429s honor the `Retry-After` header with capped backoff.
   Base64 upload works from localhost — no public image URL needed.
7. Trial vs Standard: Trial apps create sandbox-only Pins/boards (visible only to
   the creator) with daily per-app limits (`org_read`/`org_write` categories);
   upgrade to Standard for full visibility and higher limits. `npm run pinterest:doctor`
   reminds you of this.

**Current status: production publishing is NOT yet proven — no real Pinterest API
request has succeeded because no developer credentials are configured.** The full
pipeline is verified up to the API boundary (dry-run payload validates against the
official schema). To prove publishing: add credentials, run `npm run pinterest:doctor`
until READY, then publish one Pin.

Sandbox: use `https://api-sandbox.pinterest.com/v5/...` for testing if enabled on your app.

**Diagnostics & integration test:**

```powershell
npm run pinterest:doctor   # readiness checklist (exit 0 = READY, 1 = blockers listed)
npm run test               # includes tests/pinterest-integration.test.ts:
                           # builds a real pins/create payload from a synced product,
                           # validates it locally, and only publishes when
                           # PINTEREST_LIVE_PUBLISH=true + stored token +
                           # PINTEREST_TEST_BOARD_ID are ALL set (default: dry-run report)
```

## API

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | health |
| GET/POST | `/api/products`, `/api/products/sync`, `/api/products/import` | catalog |
| GET/POST/DELETE | `/api/products/:id`, `/api/products/:id/analyze` | detail + analysis |
| POST | `/api/pins/generate` | `{productId, count 1-10, creativeAngles?, template?, boardId?}` |
| GET/PATCH/DELETE | `/api/pins/:id` | pin CRUD |
| POST | `/api/pins/:id/regenerate-seo`, `/regenerate-image`, `/approve` | rework |
| GET/POST | `/api/images/providers/status`, `/api/images/generate`, `/api/images/jobs/:id` | images |
| GET | `/api/pinterest/status`, `/oauth/start`, `/oauth/callback`, `/boards`, `/pins` | pinterest |
| POST | `/api/pinterest/boards`, `/api/pinterest/publish/:pinId` | publish |
| GET/POST/DELETE | `/api/queue`, `/api/queue/schedule`, `/api/queue/:id`, `/api/queue/publish-now/:pinId` | queue |
| GET | `/api/scheduler/plan`, `/api/analytics`, `/api/dashboard`, `/api/activity` | ops |
| GET/PATCH/POST | `/api/settings`, `/api/settings/test/:which` | settings |

AI JSON contract (`SeoPackSchema`): `{title, description, primaryKeyword, secondaryKeywords[], creativeAngle, boardSuggestion, imagePrompt, cta, hashtags[]}`.

## Scheduler & safety

- `PUBLISHING_MODE=manual` (default) or `auto`; `PINS_PER_DAY=5`; `MIN_INTERVAL_MINUTES=120`; window `SCHEDULER_START_TIME/END_TIME`; timezone `APP_TIMEZONE=Europe/Madrid`.
- node-cron ticks every minute: auto-schedules `approved` pins into the window, publishes due `PublishJob`s. Jobs persist in SQLite so restarts are safe.
- Duplicate guard: SHA-256 image hash + content fingerprint + title similarity + same destination URL. Exact duplicates refused; near-duplicates return 409 with `[Publish Anyway]` option in UI (force flag).

## Storage

```
data/db/dev.db  — SQLite
data/pins/<slug>/pin-*.jpg
data/images/    — ad-hoc generations
data/logs/YYYY-MM-DD.log
```

Filenames are slugified + stamped; never overwritten; path traversal blocked.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Gumroad sync 0 products | Store may be private/changed markup — use CSV import; check `data/logs` |
| Ollama “model not found” | `ollama list`, `ollama pull llama3.1`, update `OLLAMA_MODEL`. Without Ollama the app uses an angle-aware offline fallback (distinct copy per angle, no fabricated claims) |
| ComfyUI disconnected | App still works (synthetic fallback); start ComfyUI, set `COMFYUI_URL`, pick workflow in `config/comfyui/` |
| Pinterest 401 | Reconnect (token expired/password changed); check redirect URI exact match |
| Pinterest 429 | Daily limit / rate limit — wait; lower `PINS_PER_DAY` |
| Prisma `dev.db` missing | `npm run db:migrate` from repo root (loads root `.env` via `backend/scripts/run-with-env.cjs`; `DATABASE_URL` is interpreted relative to the repo root) |
| Fastify plugin version error at startup | Keep Fastify v4 plugins aligned: `@fastify/cors@8`, `@fastify/static@6`, `@fastify/multipart@7` |
| Schedule window off by hours | Scheduler window uses wall-clock time in `APP_TIMEZONE` (applied via `TZ` at startup); keep the setting matching your PC |
| `POST` returns 415/400 with empty body | Fixed: backend tolerates empty JSON/urlencoded bodies; frontend only sends `Content-Type` when a body is present |

## Verified 2026-09-30 (Windows, Node 24)

- `npm install`, `npm run db:migrate` (migration `init` applied), `npm run test` (**29/29 pass**, incl. new Pinterest integration dry-run), `npm run lint` (backend + frontend clean), `npm run build` (backend + frontend `dist`), `npm run start` serves API + UI at `http://localhost:3000`.
- Live Gumroad sync against https://zoubire.gumroad.com: **4 products found** (First Apartment OS, Small Room Playbook, The Handover, ClientFlow Pro) with real thumbnails/prices/URLs — nothing hardcoded.
- End-to-end pin flow without external credentials: analyze → generate 5 (5 distinct angles/titles/templates/images) → approve → schedule → queue → scheduler plan; publish correctly refuses without a Pinterest connection; CSV import, image regeneration, SEO regeneration, and `npm run worker` all exercised OK.
- **Pinterest audit (spec v5.28.0):** OAuth flow, redirect-URI handling, scopes, token/refresh handling, `POST /v5/pins`, `POST /v5/boards`, `image_base64` schema, response codes, `{code,message}` errors, 429/`Retry-After`, Trial-vs-Standard, duplicates, destination-URL validation — all verified; fixes applied for destination-URL validation, numeric `board_id` enforcement, `content_type` detection, `PROTECTED` board privacy, refresh-token expiry persistence, `continuous_refresh` opt-in (pre-2025-09-25 apps), and proactive refresh.
- `npm run pinterest:doctor` result: Image ✓ (1000×1500), Destination URL ✓ (Gumroad reachable, HTTP 200), Safety ✓; Credentials/OAuth/Token/boards/pins ✗ — **expected, no developer credentials configured**. Publishing: **NOT READY (no credentials) — no real Pinterest API request has succeeded yet, so production publishing is not claimed.**
- Requires real credentials only for: Pinterest OAuth publish/boards (developer app + `PINTEREST_CLIENT_ID/SECRET`), Ollama text quality boost (optional), ComfyUI local image quality boost (optional).

## Security

- `.env` never committed; backend-only secrets (`PINTEREST_CLIENT_SECRET`, tokens).
- Zod validation on all inputs; filename sanitization; no secret logging (redactor in logger).
- Conservative scheduling defaults to respect Pinterest anti-spam expectations.

## Privacy Policy

The Pinterest developer app registration requires a public Privacy Policy URL.
PinForge AI ships a standalone static policy page for that purpose.

- **Source:** `docs/privacy-policy/index.html` — single self-contained file, no
  React/Node/external JS or CSS. Covers the real local data practices of this
  app (Gumroad public catalog, Pinterest OAuth scopes, local AI, local SQLite
  storage, no sale of personal information).
- **Deployment:** `.github/workflows/deploy-privacy-policy.yml` runs on pushes
  to `main` (and manually). It copies **only** `docs/privacy-policy/index.html`
  into the Pages artifact root — backend, frontend, `.env`, databases, images,
  logs, and tokens are never included. The policy is therefore served at the
  **site root**.
- **Public URL (verified live):** the policy is deployed at the site root:

  `https://mostre.github.io/pinforge-ai/`

  (HTTP 200 verified 2026-09-30: policy title, all 15 sections, operator name,
  and contact email present). GitHub repo: `https://github.com/MOSTRE/pinforge-ai`
  with Pages source **GitHub Actions** (`build_type: workflow`).
- **Contact email:** `abbadzoubire@gmail.com` is set in the policy. If it ever
  changes, update `docs/privacy-policy/index.html` and push to `main` to redeploy.
- **Test locally:** open `docs/privacy-policy/index.html` directly in a browser,
  or serve the folder with any static server, e.g.
  `npx serve docs/privacy-policy` then visit the printed URL.

## Scripts

`dev | build | start | test | lint | db:migrate | db:studio | sync | worker | pinterest:doctor`
