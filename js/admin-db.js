// ============================================================
// admin-db.js — Admin SQL functions via admin-proxy Edge Function
// Operasi DELETE/UPDATE/INSERT via service_role key di server-side.
// Auth: mengirim guru session (id + username) sebagai validasi.
// Hanya guru aktif yang bisa mengakses proxy ini.
// UPDATE 2026-09: tambah auto-fallback via RPC jika proxy lama (Unknown action)
// ============================================================

const ADMIN_PROXY_URL = 'https://bkecjfrwqocguyvjymkn.supabase.co/functions/v1/admin-proxy';

// Ambil session dari localStorage
function getGuruSession() {
  try { return JSON.parse(localStorage.getItem('guru_session')); } catch { return null; }
}

async function callProxy(action, body) {
  const session = getGuruSession();
  if (!session || !session.id) {
    return { data: null, error: new Error('Silakan login terlebih dahulu') };
  }

  try {
    const res = await fetch(ADMIN_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-guru-id': String(session.id),
        'x-guru-username': session.username
      },
      body: JSON.stringify({ action, ...body })
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      // beri hint deploy jika Unknown action
      let msg = errBody.error || `HTTP ${res.status}`;
      if (String(msg).includes('Unknown action')) {
        msg += ' — Edge function belum ter-deploy. Jalankan: npx supabase functions deploy admin-proxy --project-ref bkecjfrwqocguyvjymkn lalu refresh.';
      }
      return { data: null, error: new Error(msg) };
    }
    const result = await res.json();
    // proxy mengembalikan {data, error} atau {error} — normalisasi agar caller bisa cek res.error dan res.data.error
    // jika result berisi error tapi status 200 (beberapa path), tetap map ke error
    if (result && result.error && !result.data) {
      // biarkan caller cek result.error juga, tapi juga sediakan result.data = null
      return result;
    }
    return result;
  } catch (e) {
    return { data: null, error: e };
  }
}

const adminDb = {
  // Hapus 1 baris by ID
  async delete(table, id) {
    return callProxy('delete', { table, id });
  },

  // Hapus banyak baris by array of IDs
  async batchDelete(table, ids) {
    return callProxy('batch-delete', { table, data: { ids } });
  },

  // Update 1 baris by ID
  async update(table, id, setObj) {
    return callProxy('update', { table, id, data: { set: setObj } });
  },

  // Update banyak baris by filter (untuk rename mapel)
  async updateWhere(table, filter, setObj) {
    return callProxy('update', { table, filter, data: { set: setObj } });
  },

  // Rename mapel di bank_soal (RBAC: admin semua, guru hanya miliknya)
  async renameMapel(oldMapel, newMapel) {
    return callProxy('rename-mapel', { table: 'bank_soal', data: { oldMapel, newMapel } });
  },

  // Update profil guru (nama & username) — self atau admin
  // Auto-fallback via rpc jika proxy lama (Unknown action)
  async updateGuruProfile(targetId, nama, username) {
    const res = await callProxy('update-guru-profile', { data: { target_id: targetId, nama, username } });
    // jika proxy belum ter-deploy dan mengembalikan Unknown action, coba fallback langsung via RPC proxy
    if (res && res.error && String(res.error.message || res.error).includes('Unknown action')) {
      // coba via generic rpc proxy (tetap lewat admin-proxy tapi action=rpc)
      const session = getGuruSession();
      if (session) {
        const rpcRes = await callProxy('rpc', { data: { function_name: 'guru_update_profil', params: { p_actor_id: session.id, p_target_id: targetId, p_nama: nama, p_username: username } } });
        if (rpcRes && !rpcRes.error) {
          const d = rpcRes.data;
          if (d && d.success === false) return { data: null, error: new Error(d.error || 'Gagal update profil') };
          return { data: d, error: null };
        }
        // jika masih error, kembalikan error asli + hint
        return res;
      }
    }
    return res;
  },

  // Ganti password: jika self wajib oldPassword, jika admin reset cukup newPassword
  // Auto-fallback via rpc jika proxy lama
  async updateGuruPassword(targetId, oldPassword, newPassword) {
    const res = await callProxy('update-guru-password', { data: { target_id: targetId, oldPassword, newPassword } });
    if (res && res.error && String(res.error.message || res.error).includes('Unknown action')) {
      const session = getGuruSession();
      if (session) {
        // fallback via rpc proxy — tetap aman karena lewat service_role di edge
        const rpcRes = await callProxy('rpc', { data: { function_name: 'guru_ganti_password', params: { p_actor_id: session.id, p_target_id: targetId, p_old: oldPassword || '', p_new: newPassword } } });
        if (rpcRes && !rpcRes.error) {
          const d = rpcRes.data;
          if (d && d.success === false) return { data: null, error: new Error(d.error || 'Gagal ganti password') };
          return { data: d, error: null };
        }
        return res;
      }
    }
    return res;
  },

  // Alias admin reset tanpa old
  async resetGuruPassword(targetId, newPassword) {
    return this.updateGuruPassword(targetId, null, newPassword);
  },

  // Insert array of objects — dikirim sekaligus ke Edge Function
  async insert(table, dataArr) {
    return callProxy('insert', { table, data: dataArr });
  },

  // Panggil RPC function (untuk koreksi_dan_submit dll)
  async rpc(fn, params) {
    return callProxy('rpc', { data: { function_name: fn, params } });
  }
};
