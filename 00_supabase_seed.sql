-- ============================================================
-- 00_supabase_seed.sql
-- Jalankan SEKALI di Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- ============================================================
-- A. ENABLE RLS DI SEMUA TABEL
-- ============================================================
ALTER TABLE jadwal_ujian ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_soal    ENABLE ROW LEVEL SECURITY;
ALTER TABLE jawaban_ujian ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_logs   ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- B. HAPUS POLICY LAMA (supaya idempotent)
-- ============================================================
DROP POLICY IF EXISTS siswa_select_jadwal ON jadwal_ujian;
DROP POLICY IF EXISTS siswa_select_bank    ON bank_soal;
DROP POLICY IF EXISTS siswa_select_jawaban ON jawaban_ujian;
DROP POLICY IF EXISTS siswa_insert_jawaban ON jawaban_ujian;
DROP POLICY IF EXISTS siswa_update_jawaban ON jawaban_ujian;
DROP POLICY IF EXISTS siswa_insert_error   ON error_logs;

-- ============================================================
-- C. BUAT POLICY SISWA
-- ============================================================

-- 1. Semua role (anon + authenticated + service_role) bisa lihat jadwal
--    TAPI hanya service_role yang bisa INSERT/UPDATE/DELETE (lewat admin-proxy)
CREATE POLICY siswa_select_jadwal ON jadwal_ujian
    FOR SELECT
    USING (true);

-- 2. Semua role bisa lihat soal (bank_soal)
--    INSERT/UPDATE/DELETE hanya via admin-proxy (service_role)
CREATE POLICY siswa_select_bank ON bank_soal
    FOR SELECT
    USING (true);

-- 3. Semua role bisa lihat jawaban
CREATE POLICY siswa_select_jawaban ON jawaban_ujian
    FOR SELECT
    USING (true);

-- 4. Semua role bisa buat sesi jawaban baru
CREATE POLICY siswa_insert_jawaban ON jawaban_ujian
    FOR INSERT
    WITH CHECK (true);

-- 5. Semua role bisa update jawaban — tapi cegah update setelah status SELESAI
--    NOTE: Tidak ada proteksi per-user karena sistem tidak pakai Supabase Auth.
--    Siswa hanya bisa mengakses jawaban via idRowUjian yang terenkripsi di JS.
CREATE POLICY siswa_update_jawaban ON jawaban_ujian
    FOR UPDATE
    USING (true)
    WITH CHECK (COALESCE(status, '') NOT LIKE 'SELESAI%');

-- 6. Semua role bisa catat error
CREATE POLICY siswa_insert_error ON error_logs
    FOR INSERT
    WITH CHECK (true);

-- ============================================================
-- C2. REVOKE AKSES TULIS ANON UNTUK TABEL SENSITIF
-- ============================================================
-- Mencegah anon mengubah bank_soal atau jadwal_ujian langsung dari client
REVOKE INSERT, UPDATE, DELETE ON bank_soal FROM anon;
REVOKE INSERT, UPDATE, DELETE ON jadwal_ujian FROM anon;
-- Mencegah anon menghapus jawaban siswa lain
REVOKE DELETE ON jawaban_ujian FROM anon;


-- ============================================================
-- D. FUNGSI ADMIN #1: admin_delete_by_id
-- Hapus dulu overload bigint kalau ada
-- ============================================================
DROP FUNCTION IF EXISTS admin_delete_by_id(p_table text, p_id bigint);

CREATE OR REPLACE FUNCTION admin_delete_by_id(p_table text, p_id integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_result jsonb;
BEGIN
    EXECUTE format('DELETE FROM %I WHERE id = $1 RETURNING to_jsonb(%I.*)', p_table, p_table)
    INTO v_result USING p_id;

    RETURN jsonb_build_object('success', true, 'data', v_result);
END;
$$;

-- ============================================================
-- E. FUNGSI ADMIN #2: admin_batch_delete
-- Hapus dulu overload bigint[] kalau ada
-- ============================================================
DROP FUNCTION IF EXISTS admin_batch_delete(p_table text, p_ids bigint[]);

CREATE OR REPLACE FUNCTION admin_batch_delete(p_table text, p_ids integer[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    EXECUTE format('DELETE FROM %I WHERE id = ANY($1)', p_table)
    USING p_ids;

    RETURN jsonb_build_object('success', true, 'deleted_count', array_length(p_ids, 1));
END;
$$;

-- ============================================================
-- F. FUNGSI ADMIN #3: admin_update_by_id
-- Hapus dulu overload bigint kalau ada
-- ============================================================
DROP FUNCTION IF EXISTS admin_update_by_id(p_table text, p_id bigint, p_set jsonb);

CREATE OR REPLACE FUNCTION admin_update_by_id(p_table text, p_id integer, p_set jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_set_clause text := '';
    v_key text;
    v_val text;
    v_result jsonb;
BEGIN
    -- Bangun SET clause dari JSONB keys/values
    FOR v_key, v_val IN SELECT * FROM jsonb_each_text(p_set)
    LOOP
        IF v_set_clause <> '' THEN
            v_set_clause := v_set_clause || ', ';
        END IF;
        v_set_clause := v_set_clause || format('%I = %L', v_key, v_val);
    END LOOP;

    IF v_set_clause = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'No fields to update');
    END IF;

    EXECUTE format('UPDATE %I SET %s WHERE id = $1 RETURNING to_jsonb(%I.*)', p_table, v_set_clause, p_table)
    INTO v_result USING p_id;

    RETURN jsonb_build_object('success', true, 'data', v_result);
END;
$$;

-- ============================================================
-- G. FUNGSI ADMIN #4: admin_insert
-- ============================================================
CREATE OR REPLACE FUNCTION admin_insert(p_table text, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_columns text := '';
    v_values  text := '';
    v_key text;
    v_val text;
    v_result jsonb;
BEGIN
    -- Bangun kolom & value dari JSONB
    FOR v_key, v_val IN SELECT * FROM jsonb_each_text(p_data)
    LOOP
        IF v_columns <> '' THEN
            v_columns := v_columns || ', ';
            v_values  := v_values  || ', ';
        END IF;
        v_columns := v_columns || format('%I', v_key);
        v_values  := v_values  || quote_literal(v_val);
    END LOOP;

    IF v_columns = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'No data to insert');
    END IF;

    EXECUTE format('INSERT INTO %I (%s) VALUES (%s) RETURNING to_jsonb(%I.*)', p_table, v_columns, v_values, p_table)
    INTO v_result;

    RETURN jsonb_build_object('success', true, 'data', v_result);
END;
$$;


-- ============================================================
-- H. FUNGSI KOREKSI: koreksi_dan_submit
-- Dipanggil oleh siswa (index.html) & admin (offline upload)
-- SECURITY DEFINER — agar bisa UPDATE jawaban_ujian & SELECT bank_soal
-- PENTING: HANYA versi bigint 9-param (selaras hotfix 20260921). Jangan bikin varian integer —
-- kembaran integer bikin PostgREST PGRST203 "Could not choose the best candidate" (tombol Kirim gagal massal).
-- ============================================================
DROP FUNCTION IF EXISTS koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text, text);
DROP FUNCTION IF EXISTS koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text);
DROP FUNCTION IF EXISTS koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text);

CREATE OR REPLACE FUNCTION koreksi_dan_submit(
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
GRANT EXECUTE ON FUNCTION koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text, text) TO anon, authenticated, service_role;

-- ============================================================
-- I. INDEXES (untuk performa query besar)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_bank_soal_mapel ON bank_soal(mapel);
CREATE INDEX IF NOT EXISTS idx_jawaban_ujian_sesi ON jawaban_ujian(nama, kelas, mapel);
CREATE INDEX IF NOT EXISTS idx_jadwal_ujian_aktif_mapel ON jadwal_ujian(mapel, is_aktif);
CREATE INDEX IF NOT EXISTS idx_jawaban_ujian_created ON jawaban_ujian(created_at DESC);

-- ============================================================
-- J. DEFAULT PRIVILEGES — HANYA untuk role yang perlu
-- Jangan GRANT ALL to anon agar tabel baru tidak otomatis terekspos
-- ============================================================
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO postgres, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO postgres, authenticated, service_role;

-- Hanya GRANT SELECT untuk anon di tabel yang sudah ada
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
-- Berikan INSERT/UPDATE khusus untuk jawaban_ujian (siswa perlu menulis jawaban)
GRANT INSERT, UPDATE ON jawaban_ujian TO anon;

-- ============================================================
-- SELESAI — Copas semua ke Supabase SQL Editor dan RUN
-- ============================================================
