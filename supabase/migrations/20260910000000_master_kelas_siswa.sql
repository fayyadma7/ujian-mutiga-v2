-- ============================================================
-- 20260910000000_master_kelas_siswa.sql
-- Master Data Kelas & Siswa — untuk autocomplete login siswa
-- Format kelas: "X AKL A" (tanpa jurusan terpisah)
-- Jadwal multi-kelas: jadwal_ujian.kelas = "X AKL A, X AKL B"
-- ============================================================

-- pg_trgm untuk index pencarian nama
create extension if not exists pg_trgm;

-- ===================== TABEL KELAS =====================
create table if not exists kelas (
  id bigint generated always as identity primary key,
  nama text not null,
  is_aktif boolean not null default true,
  created_by bigint references guru(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint kelas_nama_not_empty check (char_length(trim(nama)) > 0),
  constraint kelas_nama_unique unique (nama)
);

create index if not exists idx_kelas_nama on kelas (nama);
create index if not exists idx_kelas_is_aktif on kelas (is_aktif);
create index if not exists idx_kelas_nama_trgm on kelas using gin (nama gin_trgm_ops);

-- ===================== TABEL SISWA =====================
create table if not exists siswa (
  id bigint generated always as identity primary key,
  nama text not null,
  kelas_id bigint references kelas(id) on delete set null,
  is_aktif boolean not null default true,
  created_by bigint references guru(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint siswa_nama_not_empty check (char_length(trim(nama)) > 0)
);

create index if not exists idx_siswa_kelas on siswa (kelas_id);
create index if not exists idx_siswa_is_aktif on siswa (is_aktif);
create index if not exists idx_siswa_nama_trgm on siswa using gin (nama gin_trgm_ops);
create index if not exists idx_siswa_nama_lower on siswa (lower(nama));
-- cegah duplikat nama+kela aktif
create unique index if not exists uq_siswa_nama_kelas on siswa (lower(nama), kelas_id) where is_aktif = true;

-- ===================== RLS =====================
alter table kelas enable row level security;
alter table siswa enable row level security;

drop policy if exists siswa_select_kelas on kelas;
drop policy if exists siswa_select_siswa on siswa;

-- anon + authenticated bisa SELECT (untuk autocomplete login)
create policy siswa_select_kelas on kelas for select using (true);
create policy siswa_select_siswa on siswa for select using (true);

-- anon tidak boleh write
revoke insert, update, delete on kelas from anon;
revoke insert, update, delete on siswa from anon;

-- grants untuk authenticated/service_role (via admin-proxy)
grant select on kelas, siswa to anon;
grant select, insert, update, delete on kelas, siswa to authenticated, service_role;
grant usage, select on sequence kelas_id_seq to authenticated, service_role;
grant usage, select on sequence siswa_id_seq to authenticated, service_role;

-- default privileges untuk tabel baru ke depan (jaga konsistensi dengan 00_supabase_seed.sql J)
alter default privileges in schema public grant select on tables to anon;
