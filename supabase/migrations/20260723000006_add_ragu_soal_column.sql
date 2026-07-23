-- ============================================================
-- Migration: Tambah kolom ragu_soal untuk sinkronisasi lintas device
-- ============================================================

ALTER TABLE jawaban_ujian
ADD COLUMN IF NOT EXISTS ragu_soal TEXT DEFAULT '';

NOTIFY pgrst, 'reload schema';
