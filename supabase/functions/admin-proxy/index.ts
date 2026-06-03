import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ⚠️ HAPUS 'null' dari daftar — mencegah eksploitasi via data: URI / file:// / sandboxed iframe
const ALLOWED_ORIGINS = [
  'https://bkecjfrwqocguyvjymkn.supabase.co',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'https://fayyadma7.github.io',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  // Hanya set Access-Control-Allow-Origin jika origin ada di daftar aman
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, x-guru-id, x-guru-username, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (allowOrigin) headers['Access-Control-Allow-Origin'] = allowOrigin;
  return headers;
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ========== SESSION VALIDATION ==========
    // Terima guru_id dari client. Verifikasi guru aktif di database.
    const guruId = req.headers.get('x-guru-id');
    const guruUsername = req.headers.get('x-guru-username');

    if (!guruId || !guruUsername) {
      return new Response(JSON.stringify({ error: 'Missing guru credentials' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: guru, error: guruErr } = await supabase
      .from('guru')
      .select('id, role, is_active')
      .eq('id', parseInt(guruId, 10))
      .eq('username', guruUsername)
      .eq('is_active', true)
      .maybeSingle();

    if (guruErr || !guru) {
      return new Response(JSON.stringify({ error: 'Unauthorized: guru not found or inactive' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ========== EXECUTE OPERATION ==========
    const { action, table, data, filter, id } = await req.json();
    let result;

    switch (action) {
      case 'delete':
        if (id) {
          result = await supabase.from(table).delete().eq('id', id);
        } else if (filter) {
          result = await supabase.from(table).delete().match(filter);
        }
        break;

      case 'batch-delete':
        result = await supabase.from(table).delete().in('id', data.ids);
        break;

      case 'update':
        if (id) {
          result = await supabase.from(table).update(data.set).eq('id', id);
        } else if (filter) {
          result = await supabase.from(table).update(data.set).match(filter);
        }
        break;

      case 'insert':
        result = await supabase.from(table).insert(data);
        break;

      case 'rpc':
        result = await supabase.rpc(data.function_name, data.params);
        break;

      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
