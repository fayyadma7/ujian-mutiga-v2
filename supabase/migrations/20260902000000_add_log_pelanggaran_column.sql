-- ============================================================
-- Migration: Tambah kolom log_pelanggaran ke jawaban_ujian
-- 
-- Kolom ini menyimpan detail log pelanggaran (newline-separated)
-- yang dikirim dari sisi siswa (index.html) via kirimSinyalAktif().
-- Format: "Pelanggaran #1: Keluar Tab (10:30:00)\nPelanggaran #2: ..."
-- 
-- Tanpa kolom ini, field log_pelanggaran selalu null meskipun
-- pelanggaran (count) berhasil tercatat.
-- ============================================================

ALTER TABLE jawaban_ujian
ADD COLUMN IF NOT EXISTS log_pelanggaran TEXT DEFAULT '';

NOTIFY pgrst, 'reload schema';
