-- ============================================================
-- Patch: izinkan karakter @ pada username guru
-- Mengupdate validasi guru_update_profil agar @ diperbolehkan
-- (misal: @lost.tempo)
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

    SELECT * INTO v_actor FROM guru WHERE id = p_actor_id AND is_active = true;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: actor tidak aktif');
    END IF;

    SELECT * INTO v_target FROM guru WHERE id = p_target_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Guru tidak ditemukan');
    END IF;

    IF p_actor_id <> p_target_id AND v_actor.role <> 'admin' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Forbidden: hanya admin boleh mengubah akun lain');
    END IF;

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

-- juga izinkan @ untuk registrasi baru (guru_daftar) — update validator
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
    v_u TEXT;
BEGIN
    v_u := trim(p_username);
    IF length(v_u) < 3 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Username minimal 3 karakter');
    END IF;
    IF length(v_u) > 30 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Username maksimal 30 karakter');
    END IF;
    IF v_u !~ '^[a-zA-Z0-9._@-]+$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Username hanya boleh huruf, angka, @, titik, underscore, strip');
    END IF;
    IF length(p_password) < 6 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Password minimal 6 karakter');
    END IF;
    IF length(p_nama) < 3 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nama minimal 3 karakter');
    END IF;

    SELECT COUNT(*) INTO v_existing FROM guru WHERE lower(username)=lower(v_u);
    IF v_existing > 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Username sudah terdaftar');
    END IF;

    SELECT COUNT(*) INTO v_existing FROM registrasi_guru WHERE lower(username)=lower(v_u) AND status = 'pending';
    IF v_existing > 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pendaftaran dengan username ini sudah diajukan dan menunggu persetujuan');
    END IF;

    INSERT INTO registrasi_guru (username, password_hash, nama)
    VALUES (v_u, extensions.crypt(p_password, extensions.gen_salt('bf', 8)), p_nama);

    RETURN jsonb_build_object('success', true, 'message', 'Pendaftaran berhasil dikirim. Tunggu persetujuan admin.');
END;
$$;

NOTIFY pgrst, 'reload schema';
