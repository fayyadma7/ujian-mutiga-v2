-- ============================================================
-- Migration 10: Fix — grant SELECT bank_soal to anon
--
-- Konteks: Migration 8 merevoke SELECT bank_soal dari anon,
-- tapi admin panel (admin_pro.html) menggunakan db (anon client)
-- untuk 19 query read ke bank_soal (termasuk preview soal, edit, dll).
--
-- Solusi:
--   - GRANT SELECT bank_soal TO anon (admin tetap bisa baca)
--   - Keamanan tetap terjaga karena student frontend pakai VIEW
--     bank_soal_siswa (tanpa kolom kunci_jawaban)
--   - Tabel kunci_jawaban tetap RLS deny all anon
-- ============================================================

GRANT SELECT ON bank_soal TO anon;
