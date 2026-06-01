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
-- Hapus dulu overload bigint kalau ada
-- ============================================================
DROP FUNCTION IF EXISTS koreksi_dan_submit(p_id_row bigint, p_nama text, p_kelas text, p_mapel text, p_jawaban jsonb, p_pelanggaran integer, p_durasi text, p_status text);

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
    v_item          jsonb;
    v_id_soal       integer;
    v_tipe          text;
    v_jawaban_siswa text;
    v_kunci         text;
    v_total_pg      integer := 0;
    v_benar_pg      integer := 0;
    v_skor_pg       integer := 0;
    v_hasil         jsonb[] := '{}';
    v_essay_list    text[] := '{}';
    v_jawaban_pg_str text := '';
BEGIN
    -- Validasi
    IF p_id_row IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_id_row tidak boleh null');
    END IF;
    IF p_jawaban IS NULL OR jsonb_array_length(p_jawaban) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_jawaban kosong');
    END IF;

    -- Loop setiap item jawaban
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_jawaban)
    LOOP
        v_id_soal := (v_item->>'id')::integer;
        v_tipe    := upper(trim(v_item->>'tipe'));
        v_jawaban_siswa := trim(v_item->>'jawaban');

        IF v_tipe = 'PG' THEN
            v_total_pg := v_total_pg + 1;

            -- Ambil kunci jawaban dari bank_soal
            SELECT kunci_jawaban INTO v_kunci
            FROM bank_soal
            WHERE id = v_id_soal AND mapel = p_mapel;

            -- Bandingkan (case-insensitive, spasi diabaikan)
            IF v_kunci IS NOT NULL AND upper(trim(v_jawaban_siswa)) = upper(trim(v_kunci)) THEN
                v_benar_pg := v_benar_pg + 1;
            END IF;

            -- Simpan detail jawaban
            v_hasil := array_append(v_hasil, jsonb_build_object(
                'id', v_id_soal,
                'jawaban', v_jawaban_siswa,
                'kunci', v_kunci
            ));

        ELSIF v_tipe = 'ESSAY' THEN
            IF v_jawaban_siswa <> '' THEN
                v_essay_list := array_append(v_essay_list, v_jawaban_siswa);
            END IF;
        END IF;
    END LOOP;

    -- Hitung skor PG (persentase, dibulatkan ke integer)
    IF v_total_pg > 0 THEN
        v_skor_pg := round((v_benar_pg::numeric / v_total_pg::numeric) * 100);
    END IF;

    -- Serialisasi jawaban_pg ke teks (array JSON valid)
    SELECT '[' || COALESCE(string_agg(j::text, ',' ORDER BY (j->>'id')::int), '') || ']'
    INTO v_jawaban_pg_str
    FROM unnest(v_hasil) AS j;

    -- Update jawaban_ujian
    UPDATE jawaban_ujian
    SET
        skor_pg       = v_skor_pg,
        jawaban_pg    = v_jawaban_pg_str,
        jawaban_essay = array_to_string(v_essay_list, '|||'),
        pelanggaran   = p_pelanggaran,
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
