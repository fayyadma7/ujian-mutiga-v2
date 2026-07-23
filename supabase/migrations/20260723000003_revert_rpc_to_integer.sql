-- ============================================================
-- Migration: Revert RPC to integer and force schema reload
-- ============================================================

-- Drop overload bigint yang salah dibuat di migration sebelumnya
DROP FUNCTION IF EXISTS koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text);
DROP FUNCTION IF EXISTS koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text);

CREATE OR REPLACE FUNCTION koreksi_dan_submit(
    p_id_row     integer,
    p_nama       text,
    p_kelas      text,
    p_mapel      text,
    p_jawaban    jsonb,
    p_pelanggaran integer DEFAULT 0,
    p_durasi     text DEFAULT '-',
    p_status     text DEFAULT 'SELESAI'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_total_pg      integer := 0;
    v_benar_pg      integer := 0;
    v_skor_pg       integer := 0;
    v_essay_list    text[] := '{}';
    v_jawaban_pg_str text;
BEGIN
    IF p_id_row IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_id_row tidak boleh null');
    END IF;
    IF p_jawaban IS NULL OR jsonb_array_length(p_jawaban) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_jawaban kosong');
    END IF;

    SELECT COUNT(*) INTO v_total_pg
    FROM jsonb_array_elements(p_jawaban) AS j
    WHERE upper(trim(j->>'tipe')) = 'PG';

    SELECT COUNT(*) INTO v_benar_pg
    FROM jsonb_array_elements(p_jawaban) AS j
    INNER JOIN bank_soal b ON b.id = (j->>'id')::integer AND b.mapel = p_mapel
    WHERE upper(trim(j->>'tipe')) = 'PG'
      AND upper(trim(b.kunci_jawaban)) = upper(trim(j->>'jawaban'));

    SELECT array_agg(j->>'jawaban') INTO v_essay_list
    FROM jsonb_array_elements(p_jawaban) AS j
    WHERE upper(trim(j->>'tipe')) = 'ESSAY'
      AND trim(j->>'jawaban') <> '';

    IF v_total_pg > 0 THEN
        v_skor_pg := round((v_benar_pg::numeric / v_total_pg::numeric) * 100);
    END IF;

    SELECT '[' || COALESCE(string_agg(
        jsonb_build_object('id', (j->>'id')::int, 'jawaban', j->>'jawaban', 'kunci', b.kunci_jawaban)::text,
        ',' ORDER BY (j->>'id')::int), '') || ']'
    INTO v_jawaban_pg_str
    FROM jsonb_array_elements(p_jawaban) AS j
    LEFT JOIN bank_soal b ON b.id = (j->>'id')::integer AND b.mapel = p_mapel
    WHERE upper(trim(j->>'tipe')) = 'PG';

    -- GREATEST untuk anti-reset pelanggaran
    UPDATE jawaban_ujian
    SET
        skor_pg       = v_skor_pg,
        jawaban_pg    = v_jawaban_pg_str,
        jawaban_essay = array_to_string(v_essay_list, '|||'),
        pelanggaran   = GREATEST(pelanggaran, p_pelanggaran),
        durasi        = p_durasi,
        status        = p_status
    WHERE id = p_id_row;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Row jawaban_ujian tidak ditemukan');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'skor', v_skor_pg,
        'benar', v_benar_pg,
        'total', v_total_pg
    );
END;
$$;

GRANT EXECUTE ON FUNCTION koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text) TO anon;
GRANT EXECUTE ON FUNCTION koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
