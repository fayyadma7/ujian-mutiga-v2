-- ============================================================
-- Pasang kembali is_anon() check di semua admin RPC
-- Setelah admin-db.js dipastikan lewat admin-proxy (service_role)
-- ============================================================

-- Buat ulang fungsi is_anon()
CREATE OR REPLACE FUNCTION is_anon()
RETURNS boolean
LANGUAGE plpgsql STABLE
AS $$
BEGIN
    RETURN coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') = 'anon';
END;
$$;

-- ============================================================
-- #1: admin_delete_by_id
-- ============================================================
CREATE OR REPLACE FUNCTION admin_delete_by_id(p_table text, p_id integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result jsonb;
BEGIN
    IF is_anon() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Access denied: anon role not allowed');
    END IF;
    EXECUTE format('DELETE FROM %I WHERE id = $1 RETURNING to_jsonb(%I.*)', p_table, p_table)
    INTO v_result USING p_id;
    RETURN jsonb_build_object('success', true, 'data', v_result);
END;
$$;

-- ============================================================
-- #2: admin_batch_delete
-- ============================================================
CREATE OR REPLACE FUNCTION admin_batch_delete(p_table text, p_ids integer[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF is_anon() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Access denied: anon role not allowed');
    END IF;
    EXECUTE format('DELETE FROM %I WHERE id = ANY($1)', p_table) USING p_ids;
    RETURN jsonb_build_object('success', true, 'deleted_count', array_length(p_ids, 1));
END;
$$;

-- ============================================================
-- #3: admin_update_by_id
-- ============================================================
CREATE OR REPLACE FUNCTION admin_update_by_id(p_table text, p_id integer, p_set jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_set_clause text := '';
    v_key text; v_val text; v_result jsonb;
BEGIN
    IF is_anon() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Access denied: anon role not allowed');
    END IF;
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

-- ============================================================
-- #4: admin_insert
-- ============================================================
CREATE OR REPLACE FUNCTION admin_insert(p_table text, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_columns text := ''; v_values text := '';
    v_key text; v_val text; v_result jsonb;
BEGIN
    IF is_anon() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Access denied: anon role not allowed');
    END IF;
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
