-- ============================================================
-- Migration 7: Fix RLS on all tables + revoke anon access
-- 
-- Supabase detected 'nilai_siswa' table with RLS disabled
-- and anon granted full access (SELECT, INSERT, UPDATE, DELETE).
-- 
-- This migration ensures ALL tables have RLS enabled,
-- proper policies, and dangerous default privileges revoked.
-- ============================================================

-- 1. AKTIFKAN RLS DI SEMUA TABEL (idempotent)
ALTER TABLE IF EXISTS jadwal_ujian    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS bank_soal       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS jawaban_ujian   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS error_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS guru            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS registrasi_guru ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS nilai_siswa     ENABLE ROW LEVEL SECURITY;

-- 2. CABUT AKSES ANON DARI TABEL SENSITIF
REVOKE ALL ON nilai_siswa FROM anon;

-- 3. CABUT DEFAULT PRIVILEGES — cegah tabel baru kena expose
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON TABLES FROM anon;

-- 4. CABUT AKSES TULIS dari tabel sensitif (lapisan keamanan tambahan)
REVOKE INSERT, UPDATE, DELETE ON bank_soal FROM anon;
REVOKE INSERT, UPDATE, DELETE ON jadwal_ujian FROM anon;
REVOKE DELETE ON jawaban_ujian FROM anon;
REVOKE INSERT, UPDATE, DELETE ON guru FROM anon;
REVOKE INSERT, UPDATE, DELETE ON registrasi_guru FROM anon;
REVOKE INSERT, UPDATE, DELETE ON error_logs FROM anon;

-- 5. POLICY UNTUK AKSES SISWA (anon)

-- jadwal_ujian: semua orang bisa lihat jadwal aktif
DROP POLICY IF EXISTS "siswa_select_jadwal" ON jadwal_ujian;
CREATE POLICY "siswa_select_jadwal" ON jadwal_ujian
    FOR SELECT USING (true);

-- bank_soal: semua orang bisa lihat soal (kunci jawaban tetap di tabel ini)
-- NOTE: Ini celah arsitektural — kunci jawaban seharusnya dipisah ke tabel terpisah
DROP POLICY IF EXISTS "siswa_select_bank" ON bank_soal;
CREATE POLICY "siswa_select_bank" ON bank_soal
    FOR SELECT USING (true);

-- jawaban_ujian: siswa bisa SELECT, INSERT, UPDATE (tidak bisa DELETE)
DROP POLICY IF EXISTS "siswa_select_jawaban" ON jawaban_ujian;
DROP POLICY IF EXISTS "siswa_insert_jawaban" ON jawaban_ujian;
DROP POLICY IF EXISTS "siswa_update_jawaban" ON jawaban_ujian;
DROP POLICY IF EXISTS "Izinkan update jawaban" ON jawaban_ujian;

CREATE POLICY "siswa_select_jawaban" ON jawaban_ujian
    FOR SELECT USING (true);
CREATE POLICY "siswa_insert_jawaban" ON jawaban_ujian
    FOR INSERT WITH CHECK (true);
CREATE POLICY "siswa_update_jawaban" ON jawaban_ujian
    FOR UPDATE USING (true)
    WITH CHECK (COALESCE(status, '') NOT LIKE 'SELESAI%');

-- error_logs: siswa bisa INSERT error log
DROP POLICY IF EXISTS "siswa_insert_error" ON error_logs;
CREATE POLICY "siswa_insert_error" ON error_logs
    FOR INSERT WITH CHECK (true);

-- guru: anon bisa SELECT untuk login (via RPC)
DROP POLICY IF EXISTS "anon_select_guru" ON guru;
CREATE POLICY "anon_select_guru" ON guru
    FOR SELECT USING (true);

-- registrasi_guru: anon bisa INSERT (mendaftar)
DROP POLICY IF EXISTS "anon_daftar_registrasi" ON registrasi_guru;
CREATE POLICY "anon_daftar_registrasi" ON registrasi_guru
    FOR INSERT WITH CHECK (true);

-- nilai_siswa: TIDAK ADA akses anon (default deny)
DROP POLICY IF EXISTS "nilai_siswa_no_access" ON nilai_siswa;
CREATE POLICY "nilai_siswa_no_access" ON nilai_siswa
    FOR ALL USING (false);
