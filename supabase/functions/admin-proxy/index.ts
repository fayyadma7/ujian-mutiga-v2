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
    let body: any = {};
    try { body = await req.json(); } catch (_) { body = {}; }
    const { action: rawAction, table, data, filter, id } = body;
    // normalisasi action biar tahan typo _ vs - dan case
    const normAction = String(rawAction || '').trim().toLowerCase().replace(/_/g, '-');

    // Blokir guru dari akses tabel admin (kecuali action guru itu sendiri yang butuh bypass)
    const guruPasswordActions = ['update-guru-password','reset-guru-password','guru-ganti-password','reset-password'];
    const guruProfilActions = ['update-guru-profile','guru-update-profil'];
    const isGuruAction = [...guruPasswordActions, ...guruProfilActions].includes(normAction);
    if (!isAdmin && ADMIN_TABLES.includes(table) && !isGuruAction) {
      return new Response(JSON.stringify({ error: 'Forbidden: admin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Blokir guru dari hapus data siswa
    if (!isAdmin && table === 'jawaban_ujian' && (normAction === 'delete' || normAction === 'batch-delete')) {
      return new Response(JSON.stringify({ error: 'Forbidden: hanya admin bisa menghapus data siswa' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let result: any;

    switch (normAction) {
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
        // sinkronkan jadwal_ujian juga (best-effort, RBAC-aware)
        try {
          if (!isAdmin) {
            await supabase.from('jadwal_ujian').update({ mapel: newMapel }).eq('mapel', oldMapel).eq('created_by', guru.id);
          } else {
            await supabase.from('jadwal_ujian').update({ mapel: newMapel }).eq('mapel', oldMapel);
          }
        } catch (_) { /* jadwal sync best-effort, jangan gagalkan rename soal */ }
        break;
      }

      case 'update-guru-profile':
      case 'guru-update-profil': {
        const targetId = parseInt(String(data?.target_id ?? data?.id ?? data?.targetId ?? ''), 10);
        const nama = (data?.nama ?? '').trim();
        const username = (data?.username ?? '').trim();
        if (!targetId || isNaN(targetId)) {
          return new Response(JSON.stringify({ error: 'ID guru tidak valid' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const { data: rpcData, error: rpcErr } = await supabase.rpc('guru_update_profil', {
          p_actor_id: guru.id,
          p_target_id: targetId,
          p_nama: nama,
          p_username: username
        });
        if (rpcErr) {
          // fallback manual jika RPC belum ada (belum push migration)
          const msg = rpcErr.message || '';
          if (msg.includes('does not exist') || msg.includes('not exist') || msg.includes('schema cache')) {
            if (!nama || nama.length < 3 || nama.length > 60) {
              return new Response(JSON.stringify({ error: 'Nama 3-60 karakter' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            if (!username || username.length < 3 || username.length > 30 || !/^[a-zA-Z0-9._@-]+$/.test(username)) {
              return new Response(JSON.stringify({ error: 'Username 3-30 karakter, hanya huruf/angka/@._-' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            const { data: target } = await supabase.from('guru').select('id, username').eq('id', targetId).maybeSingle();
            if (!target) return new Response(JSON.stringify({ error: 'Guru tidak ditemukan' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            if (guru.id !== targetId && !isAdmin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            const { data: dup } = await supabase.from('guru').select('id').ilike('username', username).neq('id', targetId).maybeSingle();
            if (dup) return new Response(JSON.stringify({ error: 'Username sudah dipakai' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            const { data: upd, error: updErr } = await supabase.from('guru').update({ nama, username }).eq('id', targetId).select('id, nama, username, role').single();
            if (updErr) return new Response(JSON.stringify({ error: updErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            result = { data: upd, error: null };
            break;
          }
          return new Response(JSON.stringify({ error: rpcErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (rpcData && (rpcData as any).success === false) {
          return new Response(JSON.stringify({ error: (rpcData as any).error || 'Gagal update profil' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (!rpcData || (rpcData as any).success === undefined) {
          if (!nama || nama.length < 3 || nama.length > 60) {
            return new Response(JSON.stringify({ error: 'Nama 3-60 karakter' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
          if (!username || username.length < 3 || username.length > 30 || !/^[a-zA-Z0-9._@-]+$/.test(username)) {
            return new Response(JSON.stringify({ error: 'Username 3-30 karakter, hanya huruf/angka/@._-' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
          const { data: target } = await supabase.from('guru').select('id, username').eq('id', targetId).maybeSingle();
          if (!target) return new Response(JSON.stringify({ error: 'Guru tidak ditemukan' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          if (guru.id !== targetId && !isAdmin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          const { data: dup } = await supabase.from('guru').select('id').ilike('username', username).neq('id', targetId).maybeSingle();
          if (dup) return new Response(JSON.stringify({ error: 'Username sudah dipakai' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          const { data: upd, error: updErr } = await supabase.from('guru').update({ nama, username }).eq('id', targetId).select('id, nama, username, role').single();
          if (updErr) return new Response(JSON.stringify({ error: updErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          result = { data: upd, error: null };
          break;
        }
        result = { data: (rpcData as any).data || rpcData, error: null };
        break;
      }

      case 'update-guru-password':
      case 'reset-guru-password':
      case 'guru-ganti-password':
      case 'reset-password': {
        const targetId = parseInt(String(data?.target_id ?? data?.targetId ?? data?.id ?? ''), 10);
        const oldPassword = data?.oldPassword ?? data?.old_password ?? data?.p_old ?? data?.pOld ?? null;
        const newPassword = String(data?.newPassword ?? data?.new_password ?? data?.p_new ?? data?.pNew ?? '').trim();
        if (!targetId || isNaN(targetId)) {
          return new Response(JSON.stringify({ error: 'ID guru tidak valid' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (!newPassword || newPassword.length < 6) {
          return new Response(JSON.stringify({ error: 'Password baru minimal 6 karakter' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (newPassword.length > 72) {
          return new Response(JSON.stringify({ error: 'Password maksimal 72 karakter' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const { data: rpcData, error: rpcErr } = await supabase.rpc('guru_ganti_password', {
          p_actor_id: guru.id,
          p_target_id: targetId,
          p_old: oldPassword || '',
          p_new: newPassword
        });
        if (rpcErr) {
          const msg = rpcErr.message || '';
          if (msg.includes('does not exist') || msg.includes('not exist') || msg.includes('schema cache')) {
            const { data: targetRow } = await supabase.from('guru').select('id, password_hash').eq('id', targetId).maybeSingle();
            if (!targetRow) return new Response(JSON.stringify({ error: 'Guru tidak ditemukan' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            if (guru.id !== targetId && !isAdmin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            if (guru.id === targetId) {
              if (!oldPassword) return new Response(JSON.stringify({ error: 'Password lama wajib diisi' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
              const { data: ok } = await supabase.rpc('guru_verify_password', { p_id: targetId, p_pass: oldPassword });
              if (!ok) return new Response(JSON.stringify({ error: 'Password lama salah' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            const { data: newHash } = await supabase.rpc('guru_hash_password', { p_pass: newPassword });
            if (!newHash) return new Response(JSON.stringify({ error: 'Gagal hash password' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            const { error: updErr2 } = await supabase.from('guru').update({ password_hash: newHash }).eq('id', targetId);
            if (updErr2) return new Response(JSON.stringify({ error: updErr2.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            result = { data: { id: targetId }, error: null };
            break;
          }
          return new Response(JSON.stringify({ error: rpcErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (rpcData && (rpcData as any).success === false) {
          return new Response(JSON.stringify({ error: (rpcData as any).error || 'Gagal ganti password' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        result = { data: rpcData, error: null };
        break;
      }

      default:
        console.warn('[admin-proxy] Unknown action:', rawAction, 'norm:', normAction);
        return new Response(JSON.stringify({ error: 'Unknown action: ' + String(rawAction) + '. Silakan deploy ulang edge function admin-proxy: npx supabase functions deploy admin-proxy --project-ref bkecjfrwqocguyvjymkn' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[admin-proxy] fatal:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
