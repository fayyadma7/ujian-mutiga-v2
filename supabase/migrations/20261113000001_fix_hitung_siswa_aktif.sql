-- 2026-11-13: Perbaikan fungsi hitung_siswa_aktif dan hitung_pelanggaran_aktif.
-- 1. Batas akhir jadwal harus: COALESCE(jw.waktu_selesai, jw.waktu_mulai) + durasi_menit,
--    karena waktu_selesai adalah batas masuk ujian (bukan akhir durasi pengerjaan).
-- 2. Batasi created_at jawaban_ujian ke 4 jam terakhir agar tidak menghitung sesi zombie lama.
-- 3. Dukung perbandingan waktu toleran timezone.

CREATE OR REPLACE FUNCTION public.hitung_siswa_aktif(
  p_kelas text DEFAULT NULL,
  p_mapel text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.jawaban_ujian j
  WHERE j.status NOT LIKE 'SELESAI%'
    AND (p_kelas  IS NULL OR trim(p_kelas)  = '' OR j.kelas = p_kelas)
    AND (p_mapel  IS NULL OR trim(p_mapel)  = '' OR lower(trim(j.mapel)) = lower(trim(p_mapel)))
    AND (p_search IS NULL OR trim(p_search) = '' OR j.nama ILIKE '%' || trim(p_search) || '%')
    -- Batasi pengerjaan aktif hanya yang dimulai maksimal 4 jam terakhir (hindari sesi zombie mati)
    AND j.created_at >= (now() - interval '4 hours')
    AND EXISTS (
      SELECT 1
      FROM public.jadwal_ujian jw
      WHERE jw.is_aktif
        AND (
          -- Sesi ujian aktif: dari waktu mulai (toleransi 30 menit awal) s.d. batas masuk + durasi
          now() >= (jw.waktu_mulai - interval '30 minutes')
          AND now() <= (
            COALESCE(jw.waktu_selesai, jw.waktu_mulai) + (COALESCE(jw.durasi_menit, 90) || ' minutes')::interval
          )
        )
        AND lower(trim(jw.mapel)) = lower(trim(j.mapel))
        AND (
          COALESCE(trim(jw.kelas), '') = ''
          OR EXISTS (
            SELECT 1
            FROM unnest(string_to_array(
                   CASE WHEN jw.kelas LIKE '%::%' THEN split_part(jw.kelas, '::', 2) ELSE jw.kelas END, ','
                 )) AS k(val)
            WHERE lower(trim(k.val)) = lower(trim(j.kelas))
          )
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.hitung_pelanggaran_aktif(
  p_kelas text DEFAULT NULL,
  p_mapel text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.jawaban_ujian j
  WHERE COALESCE(j.pelanggaran, '') ~ '[1-9]'
    AND (p_kelas  IS NULL OR trim(p_kelas)  = '' OR j.kelas = p_kelas)
    AND (p_mapel  IS NULL OR trim(p_mapel)  = '' OR lower(trim(j.mapel)) = lower(trim(p_mapel)))
    AND (p_search IS NULL OR trim(p_search) = '' OR j.nama ILIKE '%' || trim(p_search) || '%')
    AND j.created_at >= (now() - interval '4 hours')
    AND EXISTS (
      SELECT 1
      FROM public.jadwal_ujian jw
      WHERE jw.is_aktif
        AND (
          now() >= (jw.waktu_mulai - interval '30 minutes')
          AND now() <= (
            COALESCE(jw.waktu_selesai, jw.waktu_mulai) + (COALESCE(jw.durasi_menit, 90) || ' minutes')::interval
          )
        )
        AND lower(trim(jw.mapel)) = lower(trim(j.mapel))
        AND (
          COALESCE(trim(jw.kelas), '') = ''
          OR EXISTS (
            SELECT 1
            FROM unnest(string_to_array(
                   CASE WHEN jw.kelas LIKE '%::%' THEN split_part(jw.kelas, '::', 2) ELSE jw.kelas END, ','
                 )) AS k(val)
            WHERE lower(trim(k.val)) = lower(trim(j.kelas))
          )
        )
    );
$$;

GRANT EXECUTE ON FUNCTION public.hitung_siswa_aktif(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hitung_pelanggaran_aktif(text, text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
