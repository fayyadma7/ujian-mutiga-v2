-- ============================================================
-- Migration 12: Fix — existing kunci_jawaban table has 'kunci' column (NOT NULL)
--               instead of 'kunci_jawaban'. Trigger writes to wrong column.
--
-- Fix:
--   1. Add kunci_jawaban column if not exists (already from migration 8)
--   2. Make 'kunci' nullable so trigger doesn't fail
--   3. Copy data from kunci to kunci_jawaban
--   4. Update trigger to populate BOTH columns if both exist
-- ============================================================

-- 1. Tambah kolom kunci_jawaban jika belum ada
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'kunci_jawaban' AND column_name = 'kunci_jawaban'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'kunci_jawaban' AND column_name = 'kunci'
    ) THEN
        ALTER TABLE kunci_jawaban ADD COLUMN kunci_jawaban TEXT;
    END IF;
END $$;

-- 2. Drop NOT NULL on 'kunci' if it exists and is NOT NULL
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'kunci_jawaban'
          AND column_name = 'kunci'
          AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE kunci_jawaban ALTER COLUMN kunci DROP NOT NULL;
    END IF;
END $$;

-- 3. Copy existing data from kunci → kunci_jawaban (if kunci_jawaban is empty)
UPDATE kunci_jawaban
SET kunci_jawaban = kunci
WHERE kunci_jawaban IS NULL AND kunci IS NOT NULL;

-- 4. Replace trigger function — populate both 'kunci' and 'kunci_jawaban' if both exist
CREATE OR REPLACE FUNCTION trg_sync_kunci_jawaban_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_fk_col TEXT;
    v_has_both BOOLEAN;
BEGIN
    -- Deteksi kolom FK yang tersedia
    SELECT column_name INTO v_fk_col
    FROM information_schema.columns
    WHERE table_name = 'kunci_jawaban'
      AND column_name IN ('bank_soal_id', 'id_soal')
    ORDER BY column_name
    LIMIT 1;

    -- Deteksi apakah kedua kolom (kunci + kunci_jawaban) ada
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'kunci_jawaban'
          AND column_name IN ('kunci', 'kunci_jawaban')
        HAVING COUNT(*) = 2
    ) INTO v_has_both;

    IF v_fk_col IS NULL THEN
        RAISE EXCEPTION 'No FK column found in kunci_jawaban table';
    END IF;

    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        IF v_has_both THEN
            -- Populate both columns
            EXECUTE format(
                'INSERT INTO kunci_jawaban (%I, kunci, kunci_jawaban) VALUES ($1, $2, $2)
                 ON CONFLICT (%I) DO UPDATE SET kunci = EXCLUDED.kunci, kunci_jawaban = EXCLUDED.kunci_jawaban',
                v_fk_col, v_fk_col
            ) USING NEW.id, NEW.kunci_jawaban;
        ELSE
            -- Single column — detect which one exists
            EXECUTE format(
                'INSERT INTO kunci_jawaban (%I, kunci_jawaban) VALUES ($1, $2)
                 ON CONFLICT (%I) DO UPDATE SET kunci_jawaban = EXCLUDED.kunci_jawaban',
                v_fk_col, v_fk_col
            ) USING NEW.id, NEW.kunci_jawaban;
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        EXECUTE format(
            'DELETE FROM kunci_jawaban WHERE %I = $1',
            v_fk_col
        ) USING OLD.id;
        RETURN OLD;
    END IF;
END;
$$;
