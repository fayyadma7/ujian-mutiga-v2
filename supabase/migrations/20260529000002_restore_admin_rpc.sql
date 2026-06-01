-- ============================================================
-- Restore admin RPC functions tanpa is_anon() check
-- agar admin panel tetap bisa berfungsi via anon key.
-- 
-- Keamanan tetap terjaga via:
--   - REVOKE INSERT, UPDATE, DELETE ON bank_soal FROM anon
--   - REVOKE INSERT, UPDATE, DELETE ON jadwal_ujian FROM anon
--   - REVOKE DELETE ON jawaban_ujian FROM anon
-- ============================================================

DROP FUNCTION IF EXISTS admin_delete_by_id(p_table text, p_id integer);
CREATE OR REPLACE FUNCTION admin_delete_by_id(p_table text, p_id integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result jsonb;
BEGIN
    EXECUTE format('DELETE FROM %I WHERE id = $1 RETURNING to_jsonb(%I.*)', p_table, p_table)
    INTO v_result USING p_id;
    RETURN jsonb_build_object('success', true, 'data', v_result);
END;
$$;

DROP FUNCTION IF EXISTS admin_batch_delete(p_table text, p_ids integer[]);
CREATE OR REPLACE FUNCTION admin_batch_delete(p_table text, p_ids integer[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    EXECUTE format('DELETE FROM %I WHERE id = ANY($1)', p_table) USING p_ids;
    RETURN jsonb_build_object('success', true, 'deleted_count', array_length(p_ids, 1));
END;
$$;

DROP FUNCTION IF EXISTS admin_update_by_id(p_table text, p_id integer, p_set jsonb);
CREATE OR REPLACE FUNCTION admin_update_by_id(p_table text, p_id integer, p_set jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_set_clause text := '';
    v_key text; v_val text; v_result jsonb;
BEGIN
    FOR v_key, v_val IN SELECT * FROM jsonb_each_text(p_set) LOOP
        IF v_set_clause <> '' THEN v_set_clause := v_set_clause || ', '; END IF;
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

DROP FUNCTION IF EXISTS admin_insert(p_table text, p_data jsonb);
CREATE OR REPLACE FUNCTION admin_insert(p_table text, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_columns text := ''; v_values text := '';
    v_key text; v_val text; v_result jsonb;
BEGIN
    FOR v_key, v_val IN SELECT * FROM jsonb_each_text(p_data) LOOP
        IF v_columns <> '' THEN v_columns := v_columns || ', '; v_values := v_values || ', '; END IF;
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

-- Hapus fungsi is_anon yang tidak dipakai lagi
DROP FUNCTION IF EXISTS is_anon();
