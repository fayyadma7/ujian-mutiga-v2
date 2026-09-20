-- ============================================================
-- 20260920_01: Fix log_pelanggaran ketimpa (bukan ditempel)
-- Masalah: kirimSinyalAktif & koreksi_dan_submit pakai SET log=...
--          kalau ganti device, HP baru cuma punya 1 log → timpa
--          3 log lama di DB jadi hilang.
-- Fix:
--   1) Fungsi RPC append_log_pelanggaran(p_id, p_entry) — append-only
--   2) koreksi_dan_submit: jika p_log_pelanggaran not null, APPEND
--      ke log_pelanggaran existing (bukan timpa), cegah duplikat.
-- ============================================================

-- 1) RPC append-only untuk realtime pelanggaran
CREATE OR REPLACE FUNCTION append_log_pelanggaran(p_id bigint, p_entry text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_entry IS NULL OR length(trim(p_entry)) = 0 THEN RETURN; END IF;
  IF p_id IS NULL THEN RETURN; END IF;
  UPDATE jawaban_ujian
  SET log_pelanggaran = CASE
    WHEN log_pelanggaran IS NULL OR log_pelanggaran = '' THEN trim(p_entry)
    WHEN log_pelanggaran LIKE '%' || trim(p_entry) || '%' THEN log_pelanggaran -- cegah dobel entry sama persis
    ELSE log_pelanggaran || chr(10) || trim(p_entry)
  END
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION append_log_pelanggaran(bigint, text) TO anon;
GRANT EXECUTE ON FUNCTION append_log_pelanggaran(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION append_log_pelanggaran(bigint, text) TO service_role;

-- 2) Perbaiki koreksi_dan_submit agar p_log_pelanggaran di-APPEND, bukan timpa
DROP FUNCTION IF EXISTS koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text, text);
DROP FUNCTION IF EXISTS koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text, text);

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
SET search_path = public, extensions
AS $$
DECLARE
    v_total_pg       integer := 0;
    v_benar_pg       integer := 0;
    v_skor_pg        integer := 0;
    v_essay_list     text[] := '{}';
    v_jawaban_pg_str text;
    v_existing_log   text;
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

    -- Ambil log existing untuk append (cegah timpa)
    SELECT log_pelanggaran INTO v_existing_log FROM jawaban_ujian WHERE id = p_id_row;

    UPDATE jawaban_ujian
    SET
        skor_pg         = v_skor_pg,
        jawaban_pg      = v_jawaban_pg_str,
        jawaban_essay   = array_to_string(v_essay_list, '|||'),
        pelanggaran     = GREATEST(COALESCE(pelanggaran,0), p_pelanggaran),
        -- APPEND log, bukan timpa. Jika p_log lebih panjang & mengandung entry baru, tempel yang belum ada
        log_pelanggaran = CASE
            WHEN p_log_pelanggaran IS NULL OR length(trim(p_log_pelanggaran))=0 THEN log_pelanggaran
            WHEN v_existing_log IS NULL OR v_existing_log = '' THEN trim(p_log_pelanggaran)
            WHEN v_existing_log = trim(p_log_pelanggaran) THEN v_existing_log
            WHEN length(trim(p_log_pelanggaran)) <= length(v_existing_log) AND v_existing_log LIKE '%' || trim(p_log_pelanggaran) || '%' THEN v_existing_log
            -- p_log lebih panjang (HP punya log lengkap) → pakai yang terpanjang, tapi tetap pertahankan existing jika beda
            WHEN length(trim(p_log_pelanggaran)) > length(v_existing_log) THEN
                CASE WHEN v_existing_log LIKE '%' || substring(trim(p_log_pelanggaran) from 1 for 120) || '%' THEN v_existing_log ELSE v_existing_log || chr(10) || trim(p_log_pelanggaran) END
            ELSE v_existing_log || chr(10) || trim(p_log_pelanggaran)
        END,
        durasi          = p_durasi,
        status          = p_status
    WHERE id = p_id_row;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Row jawaban_ujian tidak ditemukan');
    END IF;

    RETURN jsonb_build_object('success', true, 'skor', v_skor_pg, 'benar', v_benar_pg, 'total', v_total_pg);
END;
$$;

GRANT EXECUTE ON FUNCTION koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text, text) TO service_role;

-- overload integer delegasi
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
SET search_path = public, extensions
AS $$
BEGIN
    RETURN koreksi_dan_submit(p_id_row::bigint, p_nama, p_kelas, p_mapel, p_jawaban, p_pelanggaran, p_durasi, p_status, p_log_pelanggaran);
END;
$$;

GRANT EXECUTE ON FUNCTION koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
