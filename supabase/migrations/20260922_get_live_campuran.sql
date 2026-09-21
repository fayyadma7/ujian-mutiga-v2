-- 20260922: Live campuran Sudah+BELUM menyesuaikan jadwal aktif, campur pagination, beda status
-- BELUM = j.id IS NULL (a), muncul hanya kalau ada jadwal aktif (kelas::mapel dalam window), tidak semua kelas
DROP FUNCTION IF EXISTS get_live_campuran(text,text,text,integer,integer,bigint,boolean);
DROP FUNCTION IF EXISTS get_live_campuran_count(text,text,text,bigint,boolean);
CREATE OR REPLACE FUNCTION get_live_campuran(
  p_kelas text DEFAULT NULL,
  p_mapel text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_guru_id bigint DEFAULT NULL,
  p_is_admin boolean DEFAULT true,
  p_only_active_now boolean DEFAULT false
)
RETURNS TABLE (
  siswa_id bigint,
  nama text,
  kelas_nama text,
  mapel text,
  status text,
  pelanggaran text,
  skor_pg text,
  created_at timestamptz,
  is_belum boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, extensions
AS $function$
DECLARE
  v_has_jadwal boolean := false;
BEGIN
  -- cek apakah ada jadwal aktif sekarang (dipakai bila p_kelas/p_mapel null untuk auto)
  SELECT EXISTS(
    SELECT 1 FROM jadwal_ujian
    WHERE is_aktif
      AND now() BETWEEN waktu_mulai AND COALESCE(waktu_selesai, waktu_mulai + (durasi_menit || ' minutes')::interval)
  ) INTO v_has_jadwal;

  RETURN QUERY
  WITH jadwal AS (
    SELECT trim(s.val) AS kls, jw.mapel AS mp
    FROM jadwal_ujian jw, unnest(string_to_array(CASE WHEN jw.kelas LIKE '%::%' THEN split_part(jw.kelas,'::',2) ELSE jw.kelas END, ',')) AS s(val)
    WHERE jw.is_aktif
      AND (NOT p_only_active_now OR now() BETWEEN jw.waktu_mulai AND COALESCE(jw.waktu_selesai, jw.waktu_mulai + (jw.durasi_menit || ' minutes')::interval))
      AND (p_mapel IS NULL OR jw.mapel = p_mapel)
  ),
  jadwal_distinct AS (
    SELECT DISTINCT kls, mp FROM jadwal
  ),
  sudah AS (
    SELECT j.id as j_id, j.nama as j_nama, j.kelas as j_kelas, j.mapel as j_mapel, j.status as j_status, j.pelanggaran as j_pel, j.skor_pg as j_skor, j.created_at as j_created
    FROM jawaban_ujian j
    JOIN jadwal_distinct jd ON jd.mp = j.mapel AND jd.kls = j.kelas
    WHERE (p_search IS NULL OR j.nama ILIKE '%'||p_search||'%')
      AND (p_kelas IS NULL OR j.kelas = p_kelas)
      AND (p_mapel IS NULL OR j.mapel = p_mapel)
  ),
  belum AS (
    SELECT s.id as s_id, s.nama as s_nama, k.nama as k_nama, jd.mp as mp
    FROM siswa s
    JOIN kelas k ON k.id = s.kelas_id
    JOIN jadwal_distinct jd ON jd.kls = k.nama
    LEFT JOIN jawaban_ujian j ON lower(j.nama)=lower(s.nama) AND j.kelas=k.nama AND j.mapel=jd.mp
    WHERE s.is_aktif AND k.is_aktif
      AND j.id IS NULL
      AND (p_search IS NULL OR s.nama ILIKE '%'||p_search||'%')
      AND (p_kelas IS NULL OR k.nama = p_kelas)
      AND (p_mapel IS NULL OR jd.mp = p_mapel)
      AND (p_is_admin OR s.created_by = p_guru_id)
  )
  SELECT * FROM (
    SELECT s_id as siswa_id, s_nama as nama, k_nama as kelas_nama, mp as mapel, 'BELUM MENGERJAKAN'::text as status, '-'::text as pelanggaran, NULL::text as skor_pg, NULL::timestamptz as created_at, true as is_belum
    FROM belum
    UNION ALL
    SELECT j_id as siswa_id, j_nama as nama, j_kelas as kelas_nama, j_mapel as mapel, j_status as status, COALESCE(j_pel,'-')::text as pelanggaran, j_skor::text as skor_pg, j_created as created_at, false as is_belum
    FROM sudah
  ) u
  ORDER BY is_belum DESC, nama ASC
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

DROP FUNCTION IF EXISTS get_live_campuran(text,text,text,integer,integer,bigint,boolean);
GRANT EXECUTE ON FUNCTION get_live_campuran(text, text, text, int, int, bigint, boolean, boolean) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';

-- count variant untuk pagination total
CREATE OR REPLACE FUNCTION get_live_campuran_count(
  p_kelas text DEFAULT NULL,
  p_mapel text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_guru_id bigint DEFAULT NULL,
  p_is_admin boolean DEFAULT true,
  p_only_active_now boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, extensions
AS $function$
DECLARE v_total int := 0;
BEGIN
  WITH jadwal AS (
    SELECT trim(s.val) AS kls, jw.mapel AS mp
    FROM jadwal_ujian jw, unnest(string_to_array(CASE WHEN jw.kelas LIKE '%::%' THEN split_part(jw.kelas,'::',2) ELSE jw.kelas END, ',')) AS s(val)
    WHERE jw.is_aktif
      AND (NOT p_only_active_now OR now() BETWEEN jw.waktu_mulai AND COALESCE(jw.waktu_selesai, jw.waktu_mulai + (jw.durasi_menit || ' minutes')::interval))
      AND (p_mapel IS NULL OR jw.mapel = p_mapel)
  ),
  jadwal_distinct AS (SELECT DISTINCT kls, mp FROM jadwal),
  sudah AS (SELECT 1 FROM jawaban_ujian j JOIN jadwal_distinct jd ON jd.mp=j.mapel AND jd.kls=j.kelas WHERE (p_search IS NULL OR j.nama ILIKE '%'||p_search||'%') AND (p_kelas IS NULL OR j.kelas=p_kelas) AND (p_mapel IS NULL OR j.mapel=p_mapel)),
  belum AS (SELECT 1 FROM siswa s JOIN kelas k ON k.id=s.kelas_id JOIN jadwal_distinct jd ON jd.kls=k.nama LEFT JOIN jawaban_ujian j ON lower(j.nama)=lower(s.nama) AND j.kelas=k.nama AND j.mapel=jd.mp WHERE s.is_aktif AND k.is_aktif AND j.id IS NULL AND (p_search IS NULL OR s.nama ILIKE '%'||p_search||'%') AND (p_kelas IS NULL OR k.nama=p_kelas) AND (p_mapel IS NULL OR jd.mp=p_mapel) AND (p_is_admin OR s.created_by=p_guru_id))
  SELECT (SELECT count(*) FROM sudah) + (SELECT count(*) FROM belum) INTO v_total;
  RETURN v_total;
END;
$function$;
DROP FUNCTION IF EXISTS get_live_campuran_count(text,text,text,bigint,boolean);
GRANT EXECUTE ON FUNCTION get_live_campuran_count(text, text, text, bigint, boolean, boolean) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
