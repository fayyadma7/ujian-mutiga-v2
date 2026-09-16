-- ============================================================
-- Migration: Fitur Rename Nama & Ganti Password Guru
-- Menambahkan helper dan RPC untuk update profil & password
-- Aman via admin-proxy (service_role), anon di-revoke
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Helper: hash password baru
CREATE OR REPLACE FUNCTION guru_hash_password(p_pass TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    RETURN extensions.crypt(p_pass, extensions.gen_salt('bf', 8));
END;
$$;

-- Helper: verifikasi password lama (support md5 legacy + bcrypt)
CREATE OR REPLACE FUNCTION guru_verify_password(p_id INTEGER, p_pass TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_hash TEXT;
BEGIN
    SELECT password_hash INTO v_hash FROM guru WHERE id = p_id;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_hash = md5(p_pass) THEN RETURN true; END IF;
    RETURN v_hash = extensions.crypt(p_pass, v_hash);
END;
$$;

-- ============================================================
-- RPC: Update Profil (nama & username)
-- p_actor_id = yang melakukan aksi (dari x-guru-id proxy)
-- p_target_id = guru yang akan diupdate
-- Validasi role, duplikat, format
-- ============================================================
CREATE OR REPLACE FUNCTION guru_update_profil(
    p_actor_id  INTEGER,
    p_target_id INTEGER,
    p_nama      TEXT,
    p_username  TEXT
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor   guru%ROWTYPE;
    v_target  guru%ROWTYPE;
    v_nama    TEXT;
    v_user    TEXT;
BEGIN
    v_nama := trim(p_nama);
    v_user := trim(p_username);

    -- Validasi input
    IF v_nama IS NULL OR length(v_nama) < 3 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nama minimal 3 karakter');
    END IF;
    IF length(v_nama) > 60 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nama maksimal 60 karakter');
    END IF;
    IF v_user IS NULL OR length(v_user) < 3 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Username minimal 3 karakter');
    END IF;
    IF length(v_user) > 30 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Username maksimal 30 karakter');
    END IF;
    IF v_user !~ '^[a-zA-Z0-9._@-]+$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Username hanya boleh huruf, angka, @, titik, underscore, strip');
    END IF;

    -- Cek actor
    SELECT * INTO v_actor FROM guru WHERE id = p_actor_id AND is_active = true;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: actor tidak aktif');
    END IF;

    -- Cek target
    SELECT * INTO v_target FROM guru WHERE id = p_target_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Guru tidak ditemukan');
    END IF;

    -- RBAC: hanya admin boleh edit orang lain
    IF p_actor_id <> p_target_id AND v_actor.role <> 'admin' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Forbidden: hanya admin boleh mengubah akun lain');
    END IF;

    -- Cek duplikat username di guru (case-insensitive)
    IF lower(v_user) <> lower(v_target.username) THEN
        IF EXISTS (SELECT 1 FROM guru WHERE lower(username) = lower(v_user) AND id <> p_target_id) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Username sudah dipakai guru lain');
        END IF;
        IF EXISTS (SELECT 1 FROM registrasi_guru WHERE lower(username) = lower(v_user) AND status = 'pending') THEN
            RETURN jsonb_build_object('success', false, 'error', 'Username sedang dipakai pendaftaran pending');
        END IF;
    END IF;

    UPDATE guru SET nama = v_nama, username = v_user WHERE id = p_target_id
    RETURNING * INTO v_target;

    RETURN jsonb_build_object('success', true, 'message', 'Profil berhasil diperbarui',
        'data', jsonb_build_object('id', v_target.id, 'nama', v_target.nama, 'username', v_target.username, 'role', v_target.role));
END;
$$;

-- ============================================================
-- RPC: Ganti Password
-- p_old = password lama (wajib jika actor==target, kosong jika admin reset)
-- p_new = password baru (wajib 6-72)
-- ============================================================
CREATE OR REPLACE FUNCTION guru_ganti_password(
    p_actor_id  INTEGER,
    p_target_id INTEGER,
    p_old       TEXT,
    p_new       TEXT
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor   guru%ROWTYPE;
    v_hash    TEXT;
    v_new_hash TEXT;
    v_is_self BOOLEAN;
BEGIN
    IF p_new IS NULL OR length(trim(p_new)) < 6 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Password baru minimal 6 karakter');
    END IF;
    IF length(p_new) > 72 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Password maksimal 72 karakter');
    END IF;

    SELECT * INTO v_actor FROM guru WHERE id = p_actor_id AND is_active = true;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: actor tidak aktif');
    END IF;

    SELECT password_hash INTO v_hash FROM guru WHERE id = p_target_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Guru tidak ditemukan');
    END IF;

    v_is_self := (p_actor_id = p_target_id);

    IF NOT v_is_self AND v_actor.role <> 'admin' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Forbidden: hanya admin boleh reset password orang lain');
    END IF;

    -- Jika self, verifikasi password lama
    IF v_is_self THEN
        IF p_old IS NULL OR p_old = '' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Password lama wajib diisi');
        END IF;
        -- support md5 legacy
        IF v_hash = md5(p_old) THEN
            -- ok, akan di-upgrade ke bcrypt via update
            NULL;
        ELSIF v_hash <> extensions.crypt(p_old, v_hash) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Password lama salah');
        END IF;
        -- cek password baru tidak sama dengan lama (opsional)
        IF v_hash = md5(p_new) OR v_hash = extensions.crypt(p_new, v_hash) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Password baru tidak boleh sama dengan password lama');
        END IF;
    END IF;

    v_new_hash := extensions.crypt(p_new, extensions.gen_salt('bf', 8));
    UPDATE guru SET password_hash = v_new_hash WHERE id = p_target_id;

    RETURN jsonb_build_object('success', true, 'message', 'Password berhasil diperbarui');
END;
$$;

-- Revoke anon, hanya service_role / admin via proxy yang boleh panggil langsung
REVOKE ALL ON FUNCTION guru_hash_password(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION guru_verify_password(INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION guru_update_profil(INTEGER, INTEGER, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION guru_ganti_password(INTEGER, INTEGER, TEXT, TEXT) FROM PUBLIC;

REVOKE ALL ON FUNCTION guru_hash_password(TEXT) FROM anon;
REVOKE ALL ON FUNCTION guru_verify_password(INTEGER, TEXT) FROM anon;
REVOKE ALL ON FUNCTION guru_update_profil(INTEGER, INTEGER, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION guru_ganti_password(INTEGER, INTEGER, TEXT, TEXT) FROM anon;

GRANT EXECUTE ON FUNCTION guru_hash_password(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION guru_verify_password(INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION guru_update_profil(INTEGER, INTEGER, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION guru_ganti_password(INTEGER, INTEGER, TEXT, TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION guru_hash_password(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION guru_verify_password(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION guru_update_profil(INTEGER, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION guru_ganti_password(INTEGER, INTEGER, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
