-- 20260922: tabel resmi catatan penghapusan sesi oleh admin.
-- ATURAN KERAS: siswa (index.html) hanya boleh wipe sesi + tampilkan notif "Sesi direset"
-- kalau ada baris di tabel ini (ditulis admin via Live Monitoring / Laporan Nilai).
-- Sinyal jelek / query gagal TIDAK PERNAH cocok → tidak ada reset palsu (kasus Atha).
-- Baris lama tidak perlu dibersihkan: pencocokan selalu dibatasi waktu mulai sesi lokal,
-- dan row yang masih ada selalu menang (cek row dulu sebelum cek log).
CREATE TABLE IF NOT EXISTS public.sesi_direset_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nama text NOT NULL,
    kelas text NOT NULL DEFAULT '',
    mapel text NOT NULL DEFAULT '',
    jawaban_id bigint NULL,
    deleted_by bigint NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sesi_direset_log_lookup ON public.sesi_direset_log (nama, kelas, mapel, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sesi_direset_log_created ON public.sesi_direset_log (created_at DESC);
ALTER TABLE public.sesi_direset_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sesi_direset_log_select_anon ON public.sesi_direset_log;
CREATE POLICY sesi_direset_log_select_anon ON public.sesi_direset_log FOR SELECT TO anon USING (true);
GRANT SELECT ON public.sesi_direset_log TO anon;
GRANT ALL ON public.sesi_direset_log TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
