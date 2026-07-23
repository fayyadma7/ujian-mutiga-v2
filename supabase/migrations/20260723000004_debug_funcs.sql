CREATE OR REPLACE FUNCTION get_koreksi_funcs()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_res jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
      'oid', p.oid,
      'proname', p.proname,
      'proargtypes', p.proargtypes::text,
      'proargnames', p.proargnames
  )) INTO v_res
  FROM pg_proc p
  WHERE p.proname = 'koreksi_dan_submit';
  
  RETURN v_res;
END;
$$;
GRANT EXECUTE ON FUNCTION get_koreksi_funcs() TO anon;
NOTIFY pgrst, 'reload schema';
