-- ============================================================
-- Migration: Ensure koreksi_dan_submit is callable by anon
-- and force PostgREST schema cache reload.
--
-- Setelah DROP+CREATE ulang fungsi dengan tipe parameter berbeda
-- (integer → bigint), PostgREST mungkin masih cache signature lama.
-- NOTIFY pgrst akan memaksa reload schema cache.
-- ============================================================

-- Grant EXECUTE kepada anon dan authenticated agar bisa dipanggil via RPC
GRANT EXECUTE ON FUNCTION koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text) TO anon;
GRANT EXECUTE ON FUNCTION koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text) TO authenticated;

-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
