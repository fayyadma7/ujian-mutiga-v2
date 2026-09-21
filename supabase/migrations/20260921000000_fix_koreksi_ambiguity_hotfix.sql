-- HOTFIX HARI-H 2026-09-21: PGRST203 ambiguous koreksi_dan_submit bigint vs integer
-- Penyebab: 20260920000001 cipta ulang wrapper integer setelah 20260910000003 drop, bikin PostgREST tidak bisa pilih kandidat saat JS kirim number
-- Fix: drop integer overload, keep hanya bigint, dan fix penanganan kolom pelanggaran (TEXT) yang bikin 42804
DROP FUNCTION IF EXISTS public.koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text, text);
DROP FUNCTION IF EXISTS public.koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text);
DROP FUNCTION IF EXISTS public.koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text);
-- recreate single bigint dengan fix pelanggaran TEXT -> integer handling
CREATE OR REPLACE FUNCTION public.koreksi_dan_submit(
    p_id_row          bigint,
    p_nama            text,
    p_kelas           text,
    p_mapel           text,
    p_jawaban         jsonb,
    p_pelanggaran     integer DEFAULT 0,
    p_durasi          text DEFAULT '-'::text,
    p_status          text DEFAULT 'SELESAI'::text,
    p_log_pelanggaran text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_total_pg       integer := 0;
    v_benar_pg       integer := 0;
    v_skor_pg        integer := 0;
    v_essay_list     text[] := '{}';
    v_jawaban_pg_str text;
    v_existing_log   text;
BEGIN
    IF p_id_row IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'p_id_row tidak boleh null'); END IF;
    IF p_jawaban IS NULL OR jsonb_array_length(p_jawaban) = 0 THEN RETURN jsonb_build_object('success', false, 'error', 'p_jawaban kosong'); END IF;
    SELECT COUNT(*) INTO v_total_pg FROM jsonb_array_elements(p_jawaban) AS j WHERE upper(trim(j->>'tipe')) = 'PG';
    SELECT COUNT(*) INTO v_benar_pg FROM jsonb_array_elements(p_jawaban) AS j INNER JOIN bank_soal b ON b.id = (j->>'id')::integer AND b.mapel = p_mapel WHERE upper(trim(j->>'tipe')) = 'PG' AND upper(trim(b.kunci_jawaban)) = upper(trim(j->>'jawaban'));
    SELECT array_agg(j->>'jawaban') INTO v_essay_list FROM jsonb_array_elements(p_jawaban) AS j WHERE upper(trim(j->>'tipe')) = 'ESSAY' AND trim(j->>'jawaban') <> '';
    IF v_total_pg > 0 THEN v_skor_pg := round((v_benar_pg::numeric / v_total_pg::numeric) * 100); END IF;
    SELECT '[' || COALESCE(string_agg(jsonb_build_object('id', (j->>'id')::int, 'jawaban', j->>'jawaban', 'kunci', b.kunci_jawaban)::text, ',' ORDER BY (j->>'id')::int), '') || ']' INTO v_jawaban_pg_str FROM jsonb_array_elements(p_jawaban) AS j LEFT JOIN bank_soal b ON b.id = (j->>'id')::integer AND b.mapel = p_mapel WHERE upper(trim(j->>'tipe')) = 'PG';
    SELECT log_pelanggaran INTO v_existing_log FROM jawaban_ujian WHERE id = p_id_row;
    UPDATE jawaban_ujian SET skor_pg = v_skor_pg, jawaban_pg = v_jawaban_pg_str, jawaban_essay = array_to_string(v_essay_list, '|||'), pelanggaran = GREATEST(COALESCE(NULLIF(pelanggaran,'')::integer,0), p_pelanggaran)::text, log_pelanggaran = CASE WHEN p_log_pelanggaran IS NULL OR length(trim(p_log_pelanggaran))=0 THEN log_pelanggaran WHEN v_existing_log IS NULL OR v_existing_log = '' THEN trim(p_log_pelanggaran) WHEN v_existing_log = trim(p_log_pelanggaran) THEN v_existing_log WHEN length(trim(p_log_pelanggaran)) <= length(v_existing_log) AND v_existing_log LIKE '%' || trim(p_log_pelanggaran) || '%' THEN v_existing_log WHEN length(trim(p_log_pelanggaran)) > length(v_existing_log) THEN CASE WHEN v_existing_log LIKE '%' || substring(trim(p_log_pelanggaran) from 1 for 120) || '%' THEN v_existing_log ELSE v_existing_log || chr(10) || trim(p_log_pelanggaran) END ELSE v_existing_log || chr(10) || trim(p_log_pelanggaran) END, durasi = p_durasi, status = p_status WHERE id = p_id_row;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Row jawaban_ujian tidak ditemukan'); END IF;
    RETURN jsonb_build_object('success', true, 'skor', v_skor_pg, 'benar', v_benar_pg, 'total', v_total_pg);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text, text) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
