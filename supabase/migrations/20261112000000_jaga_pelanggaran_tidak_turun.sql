-- 2026-11-12: Cegah angka pelanggaran & log pelanggaran "dicuci" oleh siswa.
--
-- Masalah:
--   1) RLS jawaban_ujian mengizinkan anon UPDATE semua baris (USING true). Dengan
--      publishable key yang ada di frontend, siapa pun bisa PATCH
--      pelanggaran='0' / log_pelanggaran='' langsung ke REST.
--   2) Klien sendiri menulis `pelanggaran: p_count` mentah dari localStorage
--      (index.html → kirimSinyalAktif). Kalau localStorage dibersihkan atau siswa
--      pindah device, angka besar di DB tertimpa angka kecil.
--   GREATEST di RPC koreksi_dan_submit hanya melindungi jalur submit, bukan update langsung.
--
-- Perbaikan: trigger BEFORE UPDATE membuat `pelanggaran` tidak bisa turun dan
-- `log_pelanggaran` tidak bisa memendek. INSERT & DELETE tidak disentuh.
--
-- Darurat (admin memang perlu menurunkan angka secara manual):
--   SELECT set_config('app.izinkan_reset_pelanggaran', 'on', false);
--   UPDATE jawaban_ujian SET pelanggaran = '0' WHERE id = ...;
--   SELECT set_config('app.izinkan_reset_pelanggaran', 'off', false);

-- Pastikan kolom log ada (idempotent) agar trigger tidak error di DB yang belum punya kolom ini
ALTER TABLE public.jawaban_ujian ADD COLUMN IF NOT EXISTS log_pelanggaran TEXT DEFAULT '';

CREATE OR REPLACE FUNCTION public.jaga_pelanggaran_ujian()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old int := 0;
  v_new int := 0;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Jalur darurat untuk admin (default: mati)
  IF COALESCE(current_setting('app.izinkan_reset_pelanggaran', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_old := GREATEST(
      COALESCE(NULLIF(regexp_replace(COALESCE(OLD.pelanggaran::text, ''), '[^0-9]', '', 'g'), ''), '0')::int,
      0
    );
  EXCEPTION WHEN others THEN v_old := 0;
  END;

  BEGIN
    v_new := GREATEST(
      COALESCE(NULLIF(regexp_replace(COALESCE(NEW.pelanggaran::text, ''), '[^0-9]', '', 'g'), ''), '0')::int,
      0
    );
  EXCEPTION WHEN others THEN v_new := 0;
  END;

  IF v_new < v_old THEN
    NEW.pelanggaran := OLD.pelanggaran;
  END IF;

  -- log_pelanggaran hanya boleh bertambah (append-only)
  IF length(COALESCE(NEW.log_pelanggaran, '')) < length(COALESCE(OLD.log_pelanggaran, '')) THEN
    NEW.log_pelanggaran := OLD.log_pelanggaran;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jaga_pelanggaran_ujian ON public.jawaban_ujian;
CREATE TRIGGER trg_jaga_pelanggaran_ujian
BEFORE UPDATE ON public.jawaban_ujian
FOR EACH ROW
EXECUTE FUNCTION public.jaga_pelanggaran_ujian();

NOTIFY pgrst, 'reload schema';
