-- ============================================================
-- Migration 5: Add role column to guru + upgrade password to bcrypt
-- ============================================================

-- 1. Tambah kolom role (admin/guru)
ALTER TABLE guru ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'guru';

-- 2. Update admin seed dengan role 'admin'
UPDATE guru SET role = 'admin' WHERE username = 'admin';

-- 3. Pastikan pgcrypto extension ada
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 4. Upgrade password dari MD5 ke bcrypt via pgcrypto
--    Gunakan search_path eksplisit via DO block untuk menemukan extensions schema.
DO $$ BEGIN
    UPDATE guru
    SET password_hash = extensions.crypt('admin123', extensions.gen_salt('bf', 8))
    WHERE username = 'admin'
      AND password_hash = md5('admin123');
END $$;

-- 4. Update RPC guru_daftar -- simpan password pakai crypt()
CREATE OR REPLACE FUNCTION guru_daftar(
    p_username TEXT,
    p_password TEXT,
    p_nama TEXT
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_existing INTEGER;
BEGIN
    -- Cek username sudah dipakai di guru atau registrasi_guru
    SELECT COUNT(*) INTO v_existing FROM guru WHERE username = p_username;
    IF v_existing > 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Username sudah terdaftar');
    END IF;

    SELECT COUNT(*) INTO v_existing FROM registrasi_guru WHERE username = p_username AND status = 'pending';
    IF v_existing > 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pendaftaran dengan username ini sudah diajukan dan menunggu persetujuan');
    END IF;

    INSERT INTO registrasi_guru (username, password_hash, nama)
    VALUES (p_username, extensions.crypt(p_password, extensions.gen_salt('bf', 8)), p_nama);

    RETURN jsonb_build_object('success', true, 'message', 'Pendaftaran berhasil dikirim. Tunggu persetujuan admin.');
END;
$$;

-- 5. Update RPC guru_login -- verifikasi pakai crypt()
CREATE OR REPLACE FUNCTION guru_login(
    p_username TEXT,
    p_password TEXT
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_guru guru%ROWTYPE;
BEGIN
    SELECT * INTO v_guru
    FROM guru
    WHERE username = p_username
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Username atau password salah');
    END IF;

    -- Cek password -- support legacy MD5 dan bcrypt
    IF v_guru.password_hash = md5(p_password) THEN
        -- Upgrade ke bcrypt
        UPDATE guru SET password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 8)) WHERE id = v_guru.id;
    ELSIF v_guru.password_hash != extensions.crypt(p_password, v_guru.password_hash) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Username atau password salah');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'id', v_guru.id,
            'username', v_guru.username,
            'nama', v_guru.nama,
            'role', v_guru.role
        )
    );
END;
$$;

-- 6. Update RPC guru_list -- include role
CREATE OR REPLACE FUNCTION guru_list()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_result jsonb;
BEGIN
    SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'username', username,
        'nama', nama,
        'role', role,
        'is_active', is_active,
        'created_at', created_at
    ) ORDER BY created_at DESC)
    INTO v_result
    FROM guru;

    RETURN jsonb_build_object('success', true, 'data', COALESCE(v_result, '[]'::jsonb));
END;
$$;

-- 7. Update RPC guru_toggle_active -- cegah non-aktifkan admin
CREATE OR REPLACE FUNCTION guru_toggle_active(
    p_guru_id INTEGER,
    p_active  BOOLEAN
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- Cegah non-aktifkan akun admin
    IF p_active = false AND p_guru_id IN (SELECT id FROM guru WHERE role = 'admin') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Tidak bisa menonaktifkan akun admin');
    END IF;

    UPDATE guru SET is_active = p_active WHERE id = p_guru_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Guru tidak ditemukan');
    END IF;
    RETURN jsonb_build_object('success', true, 'message', 'Status berhasil diubah');
END;
$$;

-- 8. Update RPC guru_hapus -- cegah hapus admin
CREATE OR REPLACE FUNCTION guru_hapus(
    p_guru_id INTEGER
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF p_guru_id IN (SELECT id FROM guru WHERE role = 'admin') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Tidak bisa menghapus akun admin');
    END IF;

    DELETE FROM guru WHERE id = p_guru_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Guru tidak ditemukan');
    END IF;
    RETURN jsonb_build_object('success', true, 'message', 'Guru berhasil dihapus');
END;
$$;
