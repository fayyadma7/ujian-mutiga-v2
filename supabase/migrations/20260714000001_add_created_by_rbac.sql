-- ============================================================
-- Migration 14: Add created_by columns for RBAC
--
-- Memungkinkan pembatasan akses per role:
-- - Admin: full akses semua data
-- - Guru: hanya CRUD data yang dia buat (created_by = guru.id)
-- ============================================================

-- 1. Tambah kolom created_by ke bank_soal
ALTER TABLE bank_soal ADD COLUMN created_by INTEGER REFERENCES guru(id);

-- 2. Tambah kolom created_by ke jadwal_ujian
ALTER TABLE jadwal_ujian ADD COLUMN created_by INTEGER REFERENCES guru(id);

-- 3. Set created_by untuk data eksisting ke admin pertama (id=1)
UPDATE bank_soal SET created_by = 1 WHERE created_by IS NULL;
UPDATE jadwal_ujian SET created_by = 1 WHERE created_by IS NULL;

-- 4. Index untuk performa query filter
CREATE INDEX IF NOT EXISTS idx_bank_soal_created_by ON bank_soal(created_by);
CREATE INDEX IF NOT EXISTS idx_jadwal_ujian_created_by ON jadwal_ujian(created_by);
