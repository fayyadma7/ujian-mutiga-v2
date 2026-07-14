-- ============================================================
-- Migration 13: Enable Realtime CDC for jawaban_ujian table
--
-- Tambah REPLICA IDENTITY FULL agar payload old row tersedia
-- di event UPDATE untuk deteksi perubahan pelanggaran/status.
-- ============================================================

ALTER TABLE jawaban_ujian REPLICA IDENTITY FULL;
