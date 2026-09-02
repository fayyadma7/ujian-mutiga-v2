-- ============================================================
-- Migration: Fix koreksi_dan_submit agar menyimpan log_pelanggaran
--
-- Masalah: Realtime kirimSinyalAktif mengirim log_pelanggaran,
-- tapi jika kolom belum ada saat pelanggaran terjadi, atau
-- update realtime gagal, log hilang. Saat submit, RPC
-- koreksi_dan_submit hanya kirim p_pelanggaran (count) tanpa log,
-- jadi GREATEST menyelamatkan count tapi log tetap kosong.
--
-- Fix: Tambah param p_log_pelanggaran + simpan ke kolom
-- jika tidak null/kosong (lebih panjang dari yang ada).
-- Drop overload integer lama agar tidak bentrok.
-- ============================================================

DROP FUNCTION IF EXISTS koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text);
DROP FUNCTION IF EXISTS koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text);
DROP FUNCTION IF EXISTS koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text, text);
DROP FUNCTION IF EXISTS koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text, text);

CREATE OR REPLACE FUNCTION koreksi_dan_submit(
    p_id_row          bigint,
    p_nama            text,
    p_kelas           text,
    p_mapel           text,
    p_jawaban         jsonb,
    p_pelanggaran     integer DEFAULT 0,
    p_durasi          text DEFAULT '-',
    p_status          text DEFAULT 'SELESAI',
    p_log_pelanggaran text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_total_pg       integer := 0;
    v_benar_pg       integer := 0;
    v_skor_pg        integer := 0;
    v_essay_list     text[] := '{}';
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

    UPDATE jawaban_ujian
    SET
        skor_pg         = v_skor_pg,
        jawaban_pg      = v_jawaban_pg_str,
        jawaban_essay   = array_to_string(v_essay_list, '|||'),
        pelanggaran     = GREATEST(COALESCE(NULLIF(pelanggaran::text, ''), '0')::integer, p_pelanggaran),
        log_pelanggaran = CASE
            WHEN p_log_pelanggaran IS NOT NULL AND length(trim(p_log_pelanggaran)) > 0
                 AND length(trim(p_log_pelanggaran)) > COALESCE(length(log_pelanggaran), 0)
            THEN p_log_pelanggaran
            ELSE log_pelanggaran
        END,
        durasi          = p_durasi,
        status          = p_status
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

GRANT EXECUTE ON FUNCTION koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text, text) TO authenticated;

-- Keep integer overload for backward compat (delegates to bigint)
CREATE OR REPLACE FUNCTION koreksi_dan_submit(
    p_id_row          integer,
    p_nama            text,
    p_kelas           text,
    p_mapel           text,
    p_jawaban         jsonb,
    p_pelanggaran     integer DEFAULT 0,
    p_durasi          text DEFAULT '-',
    p_status          text DEFAULT 'SELESAI',
    p_log_pelanggaran text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN koreksi_dan_submit(p_id_row::bigint, p_nama, p_kelas, p_mapel, p_jawaban, p_pelanggaran, p_durasi, p_status, p_log_pelanggaran);
END;
$$;

GRANT EXECUTE ON FUNCTION koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
