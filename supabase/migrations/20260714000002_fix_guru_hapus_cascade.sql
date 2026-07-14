-- ============================================================
-- Migration 15: Fix guru_hapus — hapus juga registrasi_guru
-- Saat guru dihapus, record registrasi_guru juga ikut terhapus
-- sehingga username bisa dipakai daftar ulang
-- ============================================================

CREATE OR REPLACE FUNCTION guru_hapus(
    p_guru_id INTEGER
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_username TEXT;
BEGIN
    SELECT username INTO v_username FROM guru WHERE id = p_guru_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Guru tidak ditemukan');
    END IF;
    DELETE FROM guru WHERE id = p_guru_id;
    DELETE FROM registrasi_guru WHERE username = v_username;
    RETURN jsonb_build_object('success', true, 'message', 'Guru berhasil dihapus');
END;
$$;
