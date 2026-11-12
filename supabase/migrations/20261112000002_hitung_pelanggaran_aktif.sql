-- 2026-11-12: Hitung "Ada Pelanggaran" untuk SESI YANG SEDANG BERJALAN saja.
--
-- Masalah:
--   Kartu "Ada Pelanggaran" di Live Monitoring menghitung seluruh histori
--   (COUNT ... WHERE pelanggaran <> '0'), jadi angkanya menumpuk dari sesi
--   lama — 34 pelanggaran dari ujian 28 Sep s.d. 6 Nov 2026 tetap tampil
--   padahal tidak ada satu pun jadwal yang berjalan.
--
-- Perbaikan:
--   Hitung hanya baris yang:
--     - punya pelanggaran (kolom TEXT, nilai > 0), DAN
--     - mapel + kelasnya cocok dengan jadwal_ujian yang is_aktif dan sekarang
--       berada di dalam window jadwal (waktu_mulai s.d. waktu_selesai / durasi).
--   Tanpa jadwal berjalan hasilnya 0 — konsisten dengan kartu
--   "Sedang Mengerjakan" (hitung_siswa_aktif).
--
--   Baris yang sudah SELESAI tetap dihitung selama jadwalnya masih berjalan,
--   supaya pelanggaran yang terjadi beberapa menit lalu di sesi yang sama
--   tidak hilang dari pantauan guru.
--
-- Dipakai oleh: admin-monitoring.js (kartu mon-pelanggaran).
-- Sengaja TIDAK dipakai dashboard/landing (di sana tidak ada kartu pelanggaran).

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
    AND EXISTS (
      SELECT 1
      FROM public.jadwal_ujian jw
      WHERE jw.is_aktif
        AND now() BETWEEN jw.waktu_mulai
                      AND COALESCE(
                            jw.waktu_selesai,
                            jw.waktu_mulai + (COALESCE(jw.durasi_menit, 90) || ' minutes')::interval
                          )
        AND lower(trim(jw.mapel)) = lower(trim(j.mapel))
        AND (
          -- jadwal tanpa kelas = berlaku untuk semua kelas
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

GRANT EXECUTE ON FUNCTION public.hitung_pelanggaran_aktif(text, text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
