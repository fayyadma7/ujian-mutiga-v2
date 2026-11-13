-- 2026-11-12: Bank soal ditata per MAPEL (bukan per soal)
--
-- Koreksi model:
--   Daftar Bank Soal berisi MAPEL. Yang bisa dipindah antar folder, di-rename,
--   dihapus, dan dicari adalah MAPEL. Soal hanya diakses lewat "Preview Soal"
--   (panel lama) — di sana tetap ada edit / ubah mapel / hapus soal.
--
-- Struktur:
--   bank_soal_folder menjadi satu pohon berisi dua jenis simpul:
--     - mapel IS NULL     -> folder grup (buatan guru, bisa bertingkat maks 3)
--     - mapel IS NOT NULL -> entri mapel (daun: tidak boleh diberi subfolder)
--   Lokasi soal ditentukan oleh kolom `bank_soal.mapel` — tidak ada lagi
--   folder per soal. `bank_soal.folder_id` dibiarkan ada tapi TIDAK DIPAKAI
--   lagi (deprecated), supaya deploy tidak memutus versi lama yang masih live.
--
-- Konversi data lama:
--   84 folder hasil backfill (satu per mapel, di root, namanya = mapel)
--   otomatis ditandai sebagai entri mapel. Tidak ada soal yang dipindah/dihapus.
--
-- Aman dijalankan berulang.

-- ============================================================
-- 1. Kolom penanda entri mapel
-- ============================================================
ALTER TABLE public.bank_soal_folder ADD COLUMN IF NOT EXISTS mapel text;

-- ============================================================
-- 2. Konversi folder hasil backfill menjadi entri mapel
--    (hanya folder root yang namanya sama dengan mapel milik pembuatnya)
-- ============================================================
UPDATE public.bank_soal_folder f
SET mapel = f.nama
WHERE f.mapel IS NULL
  AND f.parent_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.bank_soal b
    WHERE lower(trim(b.mapel)) = lower(f.nama)
      AND COALESCE(b.created_by, 1) = COALESCE(f.created_by, 1)
  );

CREATE INDEX IF NOT EXISTS idx_bank_soal_folder_mapel
  ON public.bank_soal_folder(lower(mapel))
  WHERE mapel IS NOT NULL;

-- Satu entri per mapel per guru (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_soal_folder_mapel
  ON public.bank_soal_folder(created_by, lower(mapel))
  WHERE mapel IS NOT NULL;

-- ============================================================
-- 3. Trigger: kedalaman folder grup + anti melingkar + mapel = daun
-- ============================================================
CREATE OR REPLACE FUNCTION public.bank_soal_folder_cek()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_parent      bigint := NEW.parent_id;
  v_depth       int := 1;          -- hanya menghitung folder grup
  v_guard       int := 0;
  v_parent_mapel text;
BEGIN
  IF v_parent IS NOT NULL THEN
    IF NEW.id IS NOT NULL AND v_parent = NEW.id THEN
      RAISE EXCEPTION 'Folder tidak boleh menjadi induk dirinya sendiri'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT f.mapel INTO v_parent_mapel
    FROM public.bank_soal_folder f
    WHERE f.id = NEW.parent_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Folder induk tidak ditemukan'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF v_parent_mapel IS NOT NULL THEN
      RAISE EXCEPTION 'Entri mapel tidak bisa diberi subfolder'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Entri mapel adalah daun: tidak ikut dihitung sebagai tingkat folder.
  IF NEW.mapel IS NULL THEN
    WHILE v_parent IS NOT NULL LOOP
      v_depth := v_depth + 1;
      IF v_depth > 3 THEN
        RAISE EXCEPTION 'Folder maksimal 3 tingkat'
          USING ERRCODE = 'check_violation';
      END IF;

      IF TG_OP = 'UPDATE' AND NEW.id IS NOT NULL AND v_parent = NEW.id THEN
        RAISE EXCEPTION 'Folder tidak boleh dipindah ke dalam subfoldernya sendiri'
          USING ERRCODE = 'check_violation';
      END IF;

      SELECT f.parent_id INTO v_parent
      FROM public.bank_soal_folder f
      WHERE f.id = v_parent;

      v_guard := v_guard + 1;
      IF v_guard > 10 THEN
        RAISE EXCEPTION 'Struktur folder terlalu dalam atau melingkar'
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_soal_folder_cek ON public.bank_soal_folder;
CREATE TRIGGER trg_bank_soal_folder_cek
  BEFORE INSERT OR UPDATE OF parent_id, mapel ON public.bank_soal_folder
  FOR EACH ROW EXECUTE FUNCTION public.bank_soal_folder_cek();

NOTIFY pgrst, 'reload schema';
