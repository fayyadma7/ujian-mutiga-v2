// ============================================================
// admin-db.js — Admin SQL functions via admin-proxy Edge Function
// Operasi DELETE/UPDATE/INSERT via service_role key di server-side.
// Auth: mengirim guru session (id + username) sebagai validasi.
// Hanya guru aktif yang bisa mengakses proxy ini.
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
      return { data: null, error: new Error(errBody.error || `HTTP ${res.status}`) };
    }
    const result = await res.json();
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

  // Insert array of objects — dikirim sekaligus ke Edge Function
  async insert(table, dataArr) {
    return callProxy('insert', { table, data: dataArr });
  },

  // Panggil RPC function (untuk koreksi_dan_submit dll)
  async rpc(fn, params) {
    return callProxy('rpc', { data: { function_name: fn, params } });
  }
};
