-- ============================================================
-- Migration 6: Add performance indexes + fix RLS + revoke defaults
-- ============================================================

-- 1. INDEX untuk performa query
-- Dipakai di koreksi_dan_submit (lookup kunci_jawaban per mapel)
CREATE INDEX IF NOT EXISTS idx_bank_soal_mapel ON bank_soal(mapel);

-- (Tidak ada kolom is_aktif di bank_soal — filter hanya by mapel)

-- Dipakai di pengecekan duplikat sesi ujian (nama + kelas + mapel)
CREATE INDEX IF NOT EXISTS idx_jawaban_ujian_sesi ON jawaban_ujian(nama, kelas, mapel);

-- Dipakai di filter jadwal aktif saat login siswa
CREATE INDEX IF NOT EXISTS idx_jadwal_ujian_aktif_mapel ON jadwal_ujian(mapel, is_aktif);

-- Dipakai di sorting laporan & monitoring (created_at DESC)
CREATE INDEX IF NOT EXISTS idx_jawaban_ujian_created ON jawaban_ujian(created_at DESC);

-- 2. Hapus default grants untuk anon — MENCEGAH tabel baru full akses
-- ALTER DEFAULT PRIVILEGES akan gagal jika tidak ada yang perlu di-revoke,
-- jadi kita pakai subquery untuk cek dulu.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_default_acl d
        JOIN pg_catalog.pg_roles r ON r.oid = d.defaclrole
        WHERE r.rolname = 'postgres'
          AND d.defaclnamespace = 'public'::regnamespace::oid
          AND d.defaclobjtype = 'r'
    ) THEN
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    END IF;
END
$$;

-- 3. Perketat REVOKE untuk tabel yang tidak perlu ditulis anon
REVOKE INSERT, UPDATE, DELETE ON bank_soal FROM anon;
REVOKE INSERT, UPDATE, DELETE ON jadwal_ujian FROM anon;
REVOKE DELETE ON jawaban_ujian FROM anon;
REVOKE INSERT, UPDATE, DELETE ON guru FROM anon;
REVOKE INSERT, UPDATE, DELETE ON registrasi_guru FROM anon;
REVOKE INSERT, UPDATE, DELETE ON error_logs FROM anon;

-- 4. RLS policy lebih ketat: cegah update jawaban setelah status SELESAI
DROP POLICY IF EXISTS "Izinkan update jawaban" ON jawaban_ujian;
CREATE POLICY "Izinkan update jawaban" ON jawaban_ujian
    FOR UPDATE USING (true)
    WITH CHECK (COALESCE(status, '') NOT LIKE 'SELESAI%');
