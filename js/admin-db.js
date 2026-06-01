// ============================================================
// admin-db.js — Admin SQL functions via admin-proxy Edge Function
// Melakukan operasi DELETE/UPDATE/INSERT/delete via service_role key
// di server-side, bukan dari browser langsung.
// ============================================================

const ADMIN_PROXY_URL = 'https://bkecjfrwqocguyvjymkn.supabase.co/functions/v1/admin-proxy';
// Ganti nilai ini jika ADMIN_SECRET diubah di Supabase Dashboard
const ADMIN_KEY = 'sk_live_ujian_mutiga_2026_f4yy4d';

async function callProxy(action, body) {
  try {
    const res = await fetch(ADMIN_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': ADMIN_KEY
      },
      body: JSON.stringify({ action, ...body })
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return { data: null, error: new Error(errBody.error || `HTTP ${res.status}`) };
    }
    const result = await res.json();
    // Edge Function return { data, error } — sama format seperti db.rpc()
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
