-- Fix ambiguity: drop integer wrapper, keep only bigint overload
-- PostgREST can't choose between integer vs bigint when JS sends JSON number
drop function if exists koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text, text);
drop function if exists koreksi_dan_submit(integer, text, text, text, jsonb, integer, text, text);
-- ensure bigint overload exists with correct grant
grant execute on function koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text, text) to anon;
grant execute on function koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text, text) to authenticated;
-- also drop old 7-param bigint if exists (should already be dropped, but safe)
drop function if exists koreksi_dan_submit(bigint, text, text, text, jsonb, integer, text, text);
notify pgrst, 'reload schema';
