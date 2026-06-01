-- ============================================================
-- Migration: Guru Accounts + Registration System
-- 
-- Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Tabel:
--   - guru: akun guru yang sudah terdaftar & disetujui
--   - registrasi_guru: pengajuan pendaftaran guru baru (pending)
--
-- RPC:
--   - guru_daftar: daftarkan guru baru (masuk ke pending)
--   - guru_login: login dengan username + password
--   - guru_setujui: setujui pendaftaran (admin)
--   - guru_tolak: tolak pendaftaran (admin)
--   - guru_list: ambil semua guru
--   - guru_list_pending: ambil semua pendaftaran pending
--   - guru_hapus: hapus guru (admin)
-- ============================================================

-- ============================================================
-- 1. TABEL
-- ============================================================

CREATE TABLE IF NOT EXISTS guru (
    id          SERIAL PRIMARY KEY,
    username    TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    nama        TEXT NOT NULL,
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Registrasi yang belum disetujui
CREATE TABLE IF NOT EXISTS registrasi_guru (
    id           SERIAL PRIMARY KEY,
    username     TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    nama         TEXT NOT NULL,
    status       TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE guru ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrasi_guru ENABLE ROW LEVEL SECURITY;

-- Policy: anon hanya bisa INSERT ke registrasi_guru (daftar), SELECT hanya lewat RPC
DROP POLICY IF EXISTS anon_daftar_registrasi ON registrasi_guru;
CREATE POLICY anon_daftar_registrasi ON registrasi_guru
    FOR INSERT
    WITH CHECK (true);

-- Policy: anon bisa SELECT guru hanya untuk login (via RPC, bukan langsung)
DROP POLICY IF EXISTS anon_select_guru ON guru;
CREATE POLICY anon_select_guru ON guru
    FOR SELECT
    USING (true);

-- REVOKE akses langsung ke tabel
REVOKE ALL ON guru FROM anon;
REVOKE ALL ON registrasi_guru FROM anon;

-- Grant hanya SELECT dan INSERT spesifik via RPC (SECURITY DEFINER akan bypass ini)
GRANT SELECT ON guru TO anon;
GRANT INSERT ON registrasi_guru TO anon;

-- ============================================================
-- 2. RPC: Guru Daftar (mendaftarkan akun baru → pending)
-- Uses SET search_path to include extensions schema for pgcrypto
-- ============================================================
CREATE OR REPLACE FUNCTION guru_daftar(
    p_username TEXT,
    p_password TEXT,
    p_nama     TEXT
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_hash TEXT;
BEGIN
    -- Validasi
    IF length(p_username) < 3 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Username minimal 3 karakter');
    END IF;
    IF length(p_password) < 6 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Password minimal 6 karakter');
    END IF;
    IF length(p_nama) < 3 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nama minimal 3 karakter');
    END IF;

    -- Cek duplikat username di guru (sudah terdaftar)
    IF EXISTS (SELECT 1 FROM guru WHERE username = p_username) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Username sudah terdaftar');
    END IF;

    -- Cek duplikat di pending
    IF EXISTS (SELECT 1 FROM registrasi_guru WHERE username = p_username AND status = 'pending') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pendaftaran dengan username ini sedang menunggu persetujuan');
    END IF;

    -- Hash password pakai md5 (built-in PostgreSQL, tidak perlu ekstensi)
    v_hash := md5(p_password);

    -- Simpan ke tabel registrasi
    INSERT INTO registrasi_guru (username, password_hash, nama, status)
    VALUES (p_username, v_hash, p_nama, 'pending');

    RETURN jsonb_build_object('success', true, 'message', 'Pendaftaran berhasil. Silakan tunggu persetujuan admin.');
END;
$$;

-- ============================================================
-- 3. RPC: Guru Login
-- ============================================================
CREATE OR REPLACE FUNCTION guru_login(
    p_username TEXT,
    p_password TEXT
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_guru guru%ROWTYPE;
BEGIN
    SELECT * INTO v_guru
    FROM guru
    WHERE username = p_username
      AND password_hash = md5(p_password)
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Username atau password salah');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'id', v_guru.id,
            'username', v_guru.username,
            'nama', v_guru.nama
        )
    );
END;
$$;

-- ============================================================
-- 4. RPC: Guru Setujui (admin menyetujui pendaftaran)
-- ============================================================
CREATE OR REPLACE FUNCTION guru_setujui(
    p_registrasi_id INTEGER
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_reg registrasi_guru%ROWTYPE;
BEGIN
    SELECT * INTO v_reg FROM registrasi_guru WHERE id = p_registrasi_id AND status = 'pending';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pendaftaran tidak ditemukan atau sudah diproses');
    END IF;

    -- Pindahkan ke tabel guru
    INSERT INTO guru (username, password_hash, nama)
    VALUES (v_reg.username, v_reg.password_hash, v_reg.nama);

    -- Update status registrasi
    UPDATE registrasi_guru SET status = 'approved' WHERE id = p_registrasi_id;

    RETURN jsonb_build_object('success', true, 'message', 'Guru berhasil disetujui');
END;
$$;

-- ============================================================
-- 5. RPC: Guru Tolak (admin menolak pendaftaran)
-- ============================================================
CREATE OR REPLACE FUNCTION guru_tolak(
    p_registrasi_id INTEGER
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    UPDATE registrasi_guru SET status = 'rejected' WHERE id = p_registrasi_id AND status = 'pending';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pendaftaran tidak ditemukan atau sudah diproses');
    END IF;
    RETURN jsonb_build_object('success', true, 'message', 'Pendaftaran ditolak');
END;
$$;

-- ============================================================
-- 6. RPC: Guru List (ambil semua guru)
-- ============================================================
CREATE OR REPLACE FUNCTION guru_list()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_result jsonb;
BEGIN
    SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'username', username,
        'nama', nama,
        'is_active', is_active,
        'created_at', created_at
    ) ORDER BY created_at DESC)
    INTO v_result
    FROM guru;

    RETURN jsonb_build_object('success', true, 'data', COALESCE(v_result, '[]'::jsonb));
END;
$$;

-- ============================================================
-- 7. RPC: Guru List Pending (ambil semua pendaftaran pending)
-- ============================================================
CREATE OR REPLACE FUNCTION guru_list_pending()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_result jsonb;
BEGIN
    SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'username', username,
        'nama', nama,
        'created_at', created_at
    ) ORDER BY created_at DESC)
    INTO v_result
    FROM registrasi_guru
    WHERE status = 'pending';

    RETURN jsonb_build_object('success', true, 'data', COALESCE(v_result, '[]'::jsonb));
END;
$$;

-- ============================================================
-- 8. RPC: Guru Hapus (admin menghapus guru)
-- ============================================================
CREATE OR REPLACE FUNCTION guru_hapus(
    p_guru_id INTEGER
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM guru WHERE id = p_guru_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Guru tidak ditemukan');
    END IF;
    RETURN jsonb_build_object('success', true, 'message', 'Guru berhasil dihapus');
END;
$$;

-- ============================================================
-- 9. RPC: Guru Aktifkan/Nonaktifkan
-- ============================================================
CREATE OR REPLACE FUNCTION guru_toggle_active(
    p_guru_id INTEGER,
    p_active  BOOLEAN
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    UPDATE guru SET is_active = p_active WHERE id = p_guru_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Guru tidak ditemukan');
    END IF;
    RETURN jsonb_build_object('success', true, 'message', 'Status berhasil diubah');
END;
$$;

-- ============================================================
-- Seed: Buat admin default (password: admin123)
-- MD5 hash of 'admin123' = 240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9
-- Tapi karena kita pakai md5() saja, hasilnya:
-- md5('admin123') = 0192023a7bbd73250516f069df18b500
-- ============================================================
INSERT INTO guru (username, password_hash, nama)
VALUES ('admin', md5('admin123'), 'Administrator')
ON CONFLICT (username) DO NOTHING;
