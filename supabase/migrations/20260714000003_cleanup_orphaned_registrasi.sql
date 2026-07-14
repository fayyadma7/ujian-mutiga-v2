-- ============================================================
-- Migration 16: Hapus registrasi_guru yang gurunya sudah dihapus
-- Membersihkan record yatim piatu agar username bisa dipakai daftar ulang
-- ============================================================

DELETE FROM registrasi_guru 
WHERE username NOT IN (SELECT username FROM guru WHERE username IS NOT NULL);
