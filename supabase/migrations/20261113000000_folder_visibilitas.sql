-- 2026-11-13: Visibilitas folder Bank Soal lintas akun
--
-- Masalah:
--   Daftar Bank Soal guru difilter `created_by = guru`, sehingga mapel milik
--   guru yang dipindahkan admin ke folder buatan admin (created_by = 1) hilang
--   dari akun guru tersebut.
--
-- Solusi:
--   Folder (dan entri mapel) tetap satu pohon. Visibilitas ditentukan per
--   simpul lewat kolom `visibilitas`:
--     inherit  -> ikut keputusan leluhur terdekat (default)
--     private  -> hanya pembuatnya
--     selected -> hanya guru yang terdaftar di bank_soal_folder_akses
--     all      -> semua guru
--   Resolusi: telusuri simpul lalu leluhurnya; nilai pertama yang bukan
--   `inherit` menang. Bila tidak ada (habis di root) -> private.
--
--   Guru SELALU melihat simpul miliknya sendiri, dan leluhur dari simpul yang
--   terlihat selalu diikutkan supaya mapel guru tidak pernah "hilang" walau
--   foldernya privat.
--
--   Guru tetap hanya boleh MEMBUKA soal miliknya sendiri — itu dijaga di UI
--   (modal "bukan buatan Anda") dan preview soal tetap difilter `created_by`.
--
--   Penulisan tetap hanya lewat edge function `admin-proxy` (service_role);
--   RLS hanya mengizinkan SELECT, sama seperti bank_soal_folder.
--
-- Aman dijalankan berulang.

-- ============================================================
-- 1. Kolom visibilitas pada bank_soal_folder
-- ============================================================
ALTER TABLE public.bank_soal_folder ADD COLUMN IF NOT EXISTS visibilitas text;

UPDATE public.bank_soal_folder
SET visibilitas = 'inherit'
WHERE visibilitas IS NULL;

ALTER TABLE public.bank_soal_folder ALTER COLUMN visibilitas SET DEFAULT 'inherit';
ALTER TABLE public.bank_soal_folder ALTER COLUMN visibilitas SET NOT NULL;

ALTER TABLE public.bank_soal_folder
  DROP CONSTRAINT IF EXISTS bank_soal_folder_visibilitas_cek;
ALTER TABLE public.bank_soal_folder
  ADD CONSTRAINT bank_soal_folder_visibilitas_cek
  CHECK (visibilitas IN ('inherit', 'private', 'selected', 'all'));

-- ============================================================
-- 2. Daftar guru yang boleh melihat folder ber-visibilitas "selected"
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bank_soal_folder_akses (
  folder_id  bigint      NOT NULL REFERENCES public.bank_soal_folder(id) ON DELETE CASCADE,
  guru_id    bigint      NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, guru_id)
);

CREATE INDEX IF NOT EXISTS idx_bs_folder_akses_guru
  ON public.bank_soal_folder_akses(guru_id);

ALTER TABLE public.bank_soal_folder_akses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bs_folder_akses_select_all" ON public.bank_soal_folder_akses;
CREATE POLICY "bs_folder_akses_select_all" ON public.bank_soal_folder_akses
  FOR SELECT USING (true);

GRANT SELECT ON public.bank_soal_folder_akses TO anon, authenticated, service_role;

-- ============================================================
-- 3. Backfill: folder grup buatan admin langsung terlihat semua guru
--    (memperbaiki bug "mapel guru hilang setelah dipindah admin")
-- ============================================================
UPDATE public.bank_soal_folder f
SET visibilitas = 'all'
WHERE f.mapel IS NULL
  AND EXISTS (
    SELECT 1 FROM public.guru g
    WHERE g.id = f.created_by AND g.role = 'admin'
  );

NOTIFY pgrst, 'reload schema';
