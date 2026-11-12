-- 2026-11-12: Hitung "siswa sedang mengerjakan" yang BENAR (bukan sesi hantu).
--
-- Masalah yang dilaporkan:
--   Live Monitoring / Dashboard / landing menampilkan "78 siswa aktif mengerjakan"
--   padahal tidak ada satu pun jadwal ujian yang aktif.
--
-- Sebab:
--   Hitungan lama hanya memakai `status NOT LIKE 'SELESAI%'` pada SELURUH histori
--   jawaban_ujian, tanpa batas waktu dan tanpa melihat jadwal. Siswa yang menutup
--   browser / kehilangan koneksi / tidak menekan "Kirim" meninggalkan baris dengan
--   status 'MENGERJAKAN' atau 'PELANGGARAN (...) - jam' yang tidak pernah ditutup,
--   sehingga terus terhitung "sedang mengerjakan" selama berbulan-bulan.
--
-- Perbaikan:
--   Satu fungsi hitung yang hanya menghitung baris yang:
--     - statusnya bukan SELESAI%, DAN
--     - mapel + kelasnya cocok dengan jadwal_ujian yang is_aktif DAN sekarang
--       berada di dalam window jadwal (waktu_mulai s.d. waktu_selesai / durasi).
--   Tanpa jadwal berjalan hasilnya 0 — sama dengan kenyataan bahwa siswa memang
--   tidak bisa memulai ujian tanpa jadwal aktif (lihat index.html → updateMapel).
--
-- Dipakai oleh: admin-monitoring.js, admin-dashboard.js, admin-core.js (landing).

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

GRANT EXECUTE ON FUNCTION public.hitung_siswa_aktif(text, text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
