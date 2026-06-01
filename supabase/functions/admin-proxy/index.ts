import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Restrict CORS to known origins — jangan pakai wildcard untuk keamanan
const ALLOWED_ORIGINS = [
  'null', // file:// (testing lokal double-click HTML)
  'https://bkecjfrwqocguyvjymkn.supabase.co',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'https://fayyadma7.github.io',
  // Tambahkan domain production di sini
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, x-admin-key, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const adminKey = req.headers.get('x-admin-key');
    // Fallback hardcoded agar bisa jalan tanpa env var di Dashboard.
    // Ganti nilai di bawah lalu set ADMIN_SECRET di Dashboard untuk override.
    const ADMIN_SECRET = Deno.env.get('ADMIN_SECRET') || 'sk_live_ujian_mutiga_2026_f4yy4d';
    if (!ADMIN_SECRET || adminKey !== ADMIN_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

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
