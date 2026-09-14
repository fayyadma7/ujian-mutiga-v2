import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function getCorsHeaders(_req: Request) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, x-guru-id, x-guru-username, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
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

    const isAdmin = guru.role === 'admin';
    const OWNED_TABLES = ['bank_soal', 'jadwal_ujian', 'kelas', 'siswa'];
    const ADMIN_TABLES = ['guru', 'registrasi_guru'];

    // ========== RBAC ==========
    const { action, table, data, filter, id } = await req.json();

    // Blokir guru dari akses tabel admin
    if (!isAdmin && ADMIN_TABLES.includes(table)) {
      return new Response(JSON.stringify({ error: 'Forbidden: admin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Blokir guru dari hapus data siswa
    if (!isAdmin && table === 'jawaban_ujian' && (action === 'delete' || action === 'batch-delete')) {
      return new Response(JSON.stringify({ error: 'Forbidden: hanya admin bisa menghapus data siswa' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let result;

    switch (action) {
      case 'delete':
        if (!isAdmin && OWNED_TABLES.includes(table)) {
          result = await supabase.from(table).delete().eq('id', id).eq('created_by', guru.id);
        } else if (id) {
          result = await supabase.from(table).delete().eq('id', id);
        } else if (filter) {
          result = await supabase.from(table).delete().match(filter);
        }
        break;

      case 'batch-delete':
        if (!isAdmin && OWNED_TABLES.includes(table)) {
          result = await supabase.from(table).delete().in('id', data.ids).eq('created_by', guru.id);
        } else {
          result = await supabase.from(table).delete().in('id', data.ids);
        }
        break;

      case 'update':
        if (!isAdmin && OWNED_TABLES.includes(table)) {
          if (id) {
            result = await supabase.from(table).update(data.set).eq('id', id).eq('created_by', guru.id);
          } else if (filter) {
            result = await supabase.from(table).update(data.set).match({ ...filter, created_by: guru.id });
          }
        } else if (id) {
          result = await supabase.from(table).update(data.set).eq('id', id);
        } else if (filter) {
          result = await supabase.from(table).update(data.set).match(filter);
        }
        break;

      case 'insert':
        if (OWNED_TABLES.includes(table)) {
          const withOwner = Array.isArray(data)
            ? data.map(row => ({ ...row, created_by: row.created_by ?? guru.id }))
            : { ...data, created_by: (data as any).created_by ?? guru.id };
          result = await supabase.from(table).insert(withOwner);
        } else {
          result = await supabase.from(table).insert(data);
        }
        break;

      case 'rpc':
        result = await supabase.rpc(data.function_name, data.params);
        break;

      case 'rename-mapel': {
        const oldMapel = (data?.oldMapel || '').trim();
        const newMapel = (data?.newMapel || '').trim();
        if (!oldMapel || !newMapel) {
          return new Response(JSON.stringify({ error: 'Nama mapel lama dan baru wajib diisi' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        if (oldMapel === newMapel) {
          return new Response(JSON.stringify({ error: 'Nama baru sama dengan nama lama' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        if (newMapel.length < 2 || newMapel.length > 80) {
          return new Response(JSON.stringify({ error: 'Nama mapel 2-80 karakter' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        // Cek kepemilikan untuk guru
        let countQuery = supabase.from('bank_soal').select('id', { count: 'exact', head: true }).eq('mapel', oldMapel);
        if (!isAdmin) countQuery = countQuery.eq('created_by', guru.id);
        const { count: ownCount, error: cntErr } = await countQuery;
        if (cntErr) {
          result = { error: cntErr };
          break;
        }
        if (!ownCount || ownCount === 0) {
          return new Response(JSON.stringify({ error: isAdmin ? 'Mapel tidak ditemukan' : 'Anda tidak memiliki soal dengan mapel tersebut' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        if (!isAdmin) {
          result = await supabase.from('bank_soal').update({ mapel: newMapel }).eq('mapel', oldMapel).eq('created_by', guru.id);
        } else {
          result = await supabase.from('bank_soal').update({ mapel: newMapel }).eq('mapel', oldMapel);
        }
        break;
      }

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
