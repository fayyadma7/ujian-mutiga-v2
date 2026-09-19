-- ============================================================
-- 20260920: Fix double-click = data ganda saat login
-- - Klik 2x di "Ya, Mulai!" bikin 2 INSERT bareng karena
--   cek existing (maybeSingle) tidak atomic + idx lama cuma INDEX.
-- - Fix: UNIQUE INDEX partial + cleanup duplikat lama
-- ============================================================

-- 1. Bersihkan duplikat lama (sisa data ganda sebelum fix)
--    Simpan 1 baris tertua per (lower(nama), lower(kelas), mapel) yang belum SELESAI
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT lower(trim(nama)) AS ln, lower(trim(kelas)) AS lk, mapel, array_agg(id ORDER BY created_at, id) AS ids
    FROM jawaban_ujian
    WHERE COALESCE(status,'') NOT LIKE 'SELESAI%'
    GROUP BY lower(trim(nama)), lower(trim(kelas)), mapel
    HAVING count(*) > 1
  LOOP
    -- hapus id ke-2 dst, sisakan ids[1]
    DELETE FROM jawaban_ujian WHERE id = ANY(r.ids[2:array_length(r.ids,1)]);
  END LOOP;
END $$;

-- 2. UNIQUE INDEX partial — cegah 2 sesi aktif bareng (atomik di DB, bukan di JS)
--    lower+trim biar "Budi " vs "budi" tetap dianggap sama
DROP INDEX IF EXISTS idx_jawaban_ujian_sesi;
CREATE UNIQUE INDEX IF NOT EXISTS uq_jawaban_sesi_aktif
  ON jawaban_ujian (lower(trim(nama)), lower(trim(kelas)), mapel)
  WHERE COALESCE(status,'') NOT LIKE 'SELESAI%';

-- 3. Index bantu cek SELESAI% tetap cepat
CREATE INDEX IF NOT EXISTS idx_jawaban_sesi_selesai
  ON jawaban_ujian (lower(trim(nama)), lower(trim(kelas)), mapel)
  WHERE COALESCE(status,'') LIKE 'SELESAI%';

NOTIFY pgrst, 'reload schema';
