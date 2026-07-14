# AGENTS.md — Project Web Ujian PRO

Sistem CBT untuk SMK Muhammadiyah 3 Purbalingga. Frontend HTML/JS statis + backend Supabase. Tanpa build tools, tanpa bundler, tanpa `package.json`.

## Cara Menjalankan

```bash
npx supabase start          # Docker wajib — API:54321, DB:54322, Studio:54323
npx supabase stop
npx supabase db reset       # jalankan ulang semua migrasi + seed
npx supabase db push        # dorong migrasi ke remote
npx serve . -p 3000         # server statis apa saja — tanpa build step
```

## Arsitektur Utama

| Lapisan | Lokasi | Catatan |
|---|---|---|
| SPA Siswa | `index.html` | Bootstrap 5, MathJax inline, klien Supabase anon |
| SPA Admin | `admin_pro.html` + `admin/js/*.js` | Inter, FontAwesome, SweetAlert2, **KaTeX eager**, Chart.js/SheetJS/Mammoth/MathJax lazy |
| Proxy DB Admin | `js/admin-db.js` → edge function `admin-proxy` | Semua write lewat sini; jangan pakai klien anon untuk write |
| Edge functions | `supabase/functions/admin-proxy/`, `supabase/functions/gemini-proxy/` | Deno 2, `verify_jwt = false`, import map via `deno.json` |
| Migrasi | `supabase/migrations/` | 12 file, dijalankan berurutan berdasarkan awalan timestamp |
| Seed | `00_supabase_seed.sql` (root — BUKAN `supabase/seed.sql`) | Harus dijalankan manual di SQL Editor Supabase |
| Utilitas tes | `loadtest2.html`, `test_queue.html` | Halaman tes load/queue mandiri (bukan bagian SPA utama) |

## Auth

- **Siswa**: Anonim. Jawaban terikat ke `idRowUjian` (dienkripsi di sisi klien).
- **Guru/Admin**: Auth kustom via tabel `guru` (bcrypt). Session di `localStorage` sebagai `guru_session` dengan `{ id, username, role, nama }`. Tanpa httpOnly cookies, tanpa refresh token.
- `upgradeSession()` di `admin-core.js` mengambil role terbaru dari DB saat load.

## Gemini-proxy (`functions/gemini-proxy/index.ts`)

Proxy AI multi-provider. Body request: `{ provider?, promptText, temperature? }`. Provider: `gemini` (default, model `gemini-2.5-flash-lite`), `cerebras`, `groq`, `mistral`. Rotasi antar env var `GEMINI_API_KEY` / `_1` / `_2` / `_3`.

## Hal-Hal yang Akan Menjebak

1. **`supabase/config.toml` path seed adalah `./seed.sql` tapi file itu tidak ada.** Gunakan `00_supabase_seed.sql` di root repo — jalankan sekali di SQL Editor.
2. **admin-proxy melewati RLS sepenuhnya** — `SUPABASE_SERVICE_ROLE_KEY`. Validasi session (header `x-guru-id`, `x-guru-username`) adalah satu-satunya pengaman.
3. **Tidak ada TypeScript di frontend** — semua JS vanilla dengan `// @ts-nocheck`.
4. **Klien Supabase diinisialisasi dua kali** — `index.html` (siswa) dan `admin-core.js` (admin), dengan anon key yang sama.
5. **Import Deno di edge function** — kode runtime menggunakan URL pinned `https://deno.land/std@0.168.0/http/server.ts` dan `https://esm.sh/@supabase/supabase-js@2`; import map `deno.json` menggunakan `jsr:` untuk functions-js dan `esm.sh` untuk supabase-js. Jangan update tanpa pengujian.
6. **Anti-cheat hanya CSS/JS** — `user-select: none`, deteksi pindah tab, blokir print. Mudah dilewati.
7. **Loading MathJax berbeda** — sisi siswa: script inline di `index.html`. Sisi admin: lazy via `loadMathJax()` di `admin-soal.js`. KaTeX di-load eager di `admin_pro.html`.
8. **`chunkedInsert`** di `admin-core.js` membagi insert ke dalam potongan 50 via `adminDb.insert()`. Pertahankan pola ini untuk operasi massal.
9. **ID project Supabase**: `Project_Web_Ujian_PRO`, remote: `bkecjfrwqocguyvjymkn`.
