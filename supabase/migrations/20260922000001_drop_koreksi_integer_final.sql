-- 20260922: pastikan hanya SATU overload koreksi_dan_submit (bigint 9-param dari hotfix 20260921).
-- Mencegah PGRST203 "Could not choose the best candidate function" yang bikin tombol Kirim gagal massal.
-- Kembaran integer bisa lahir lagi kalau seed/migrasi lama di-run ulang — file ini aman di-run berulang.
DROP FUNCTION IF EXISTS public.koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text, text);
DROP FUNCTION IF EXISTS public.koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text);
DROP FUNCTION IF EXISTS public.koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text);
NOTIFY pgrst, 'reload schema';
