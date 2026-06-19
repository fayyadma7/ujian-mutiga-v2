# AGENTS.md — Project Web Ujian PRO

## What This Is

A **CBT (Computer-Based Test)** system for SMK Muhammadiyah 3 Purbalingga. Static HTML/JS frontend + Supabase backend (PostgreSQL 17 + Deno Edge Functions). No build tools, no bundler, no `package.json`.

## Directory Layout

```
index.html            → Student exam interface (landing + exam form, single-page)
admin_pro.html        → Admin dashboard SPA
js/admin-db.js        → Admin DB proxy client (calls admin-proxy edge function)
admin/css/            → Admin styles: admin-base.css, admin-components.css, admin-pages.css
admin/js/             → Admin SPA modules (loaded lazily):
  admin-core.js         → Supabase init, session mgmt, page nav, toast, chunkedInsert
  admin-dashboard.js    → Dashboard panel
  admin-soal.js         → Question bank CRUD, AI generation, Word/Excel import
  admin-guru.js         → Teacher management
  admin-jadwal.js       → Exam schedule management
  admin-monitoring.js   → Live exam monitoring
  admin-laporan.js      → Reports
  admin-analisis.js     → Analytics/charts
supabase/
  config.toml           → Local dev config (API:54321, DB:54322, Studio:54323)
  migrations/           → 12 SQL migration files (run in order)
  functions/admin-proxy/ → Edge function: admin CRUD via service_role key
  functions-/           → Gemini API proxy (separate/backup, has trailing dash in name)
assets/                 → Static images (logo, background)
00_supabase_seed.sql    → Manual seed file (run once in SQL Editor, NOT via supabase db seed)
```

## How to Run Locally

```bash
# Start Supabase local dev (Docker required)
npx supabase start

# Stop
npx supabase stop

# Reset DB (re-run all migrations + seed)
npx supabase db reset

# Push migrations to remote
npx supabase db push

# Serve frontend (any static server)
npx serve . -p 3000
# Or use VS Code Live Server, Python http.server, etc.
```

There is no build step. Edit files directly, refresh browser.

## Database Security Model

- **RLS enabled on ALL tables**. Anon role has SELECT only on student-facing tables.
- **All write operations** (INSERT/UPDATE/DELETE on bank_soal, jadwal_ujian, etc.) go through the `admin-proxy` Edge Function, which uses the `SUPABASE_SERVICE_ROLE_KEY` and validates the guru session via `x-guru-id` / `x-guru-username` headers.
- **Never bypass the admin-proxy** for writes. Direct anon writes are blocked by REVOKE + RLS.
- RPC functions (e.g., `koreksi_dan_submit`, `guru_login`) are called via `adminDb.rpc()` or direct Supabase client.

## Auth Flow

- **Students**: No login required. Anonymous access. Answers tied to `idRowUjian` (encrypted in JS).
- **Admin/Guru**: Custom auth via `guru` table (bcrypt passwords). Session stored in `localStorage` as `guru_session` with fields: `{ id, username, role, nama }`.
- `upgradeSession()` in `admin-core.js` fetches fresh role from DB on load.

## Key Tables

| Table | Purpose | Write Path |
|---|---|---|
| `jadwal_ujian` | Exam schedules | admin-proxy |
| `bank_soal` | Question bank (soal + options) | admin-proxy |
| `jawaban_ujian` | Student answer sessions | Direct anon (INSERT/UPDATE) |
| `guru` | Teacher accounts + roles | admin-proxy |
| `registrasi_guru` | Pending teacher registrations | admin-proxy |
| `nilai_siswa` | Student score summaries | admin-proxy |
| `error_logs` | Client error logs | Direct anon (INSERT only) |

## Edge Functions

- **admin-proxy** (`supabase/functions/admin-proxy/index.ts`): Handles `delete`, `batch-delete`, `update`, `insert`, `rpc` actions. Uses `SUPABASE_SERVICE_ROLE_KEY`. CORS whitelist: `supabase.co`, `127.0.0.1:3000`, `localhost:3000`, `fayyadma7.github.io`.
- **Gemini proxy** (`supabase/functions-/index.ts`): Proxies requests to Gemini Flash API. Uses `GEMINI_API_KEY` env var. Note the directory name has a trailing dash.

## Migration Naming Convention

Files follow `YYYYMMDDHHMMSS_description.sql`. Run order matters. The latest migration is `20260603140000`.

## Admin SPA Script Loading

`admin_pro.html` loads three CSS files and `js/admin-db.js` eagerly. All `admin/js/admin-*.js` modules are loaded **lazily** via `loadScript()` in `admin-core.js`. Heavy libraries (Chart.js, SheetJS, Mammoth, MathJax) are also lazy-loaded on demand.

## Things That Will Bite You

1. **`supabase/functions-/`** (with trailing dash) is a separate directory from `supabase/functions/`. Don't confuse them.
2. **`00_supabase_seed.sql`** at root is NOT in `supabase/seeds/`. The Supabase config points to `supabase/seed.sql` for `supabase db seed`, but this file lives at root. It must be run manually in SQL Editor.
3. **`admin-proxy` uses `SUPABASE_SERVICE_ROLE_KEY`** — it bypasses RLS entirely. Session validation is the only guard.
4. **No TypeScript in frontend** — all JS is vanilla, `@ts-nocheck` in admin modules. Don't expect type safety.
5. **Supabase client is initialized twice**: once in `index.html` (student side) and once in `admin-core.js` (admin side) with the same anon key.
6. **localStorage is the session store** — `guru_session` key. No httpOnly cookies, no secure token refresh.
7. **Anti-cheat is CSS/JS-only** — `user-select: none`, tab-switch detection, print blocking. Easily bypassed but sufficient for school-level integrity.
8. **MathJax** is loaded differently on student side (inline in `index.html`) vs admin side (lazy via `loadMathJax()` in `admin-soal.js`).
9. **Edge function Deno imports** use pinned URLs (`esm.sh/@supabase/supabase-js@2`, `deno.land/std@0.168.0`). Don't update these without testing edge function deploy.
10. **Supabase project ID**: `Project_Web_Ujian_PRO`, remote: `bkecjfrwqocguyvjymkn`.
