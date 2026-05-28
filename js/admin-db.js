// ============================================================
// admin-db.js — Admin SQL functions via db.rpc()
// BYPASS RLS — untuk operasi DELETE, UPDATE, INSERT oleh admin
// Panggil SQL functions yg sudah di-deploy via Supabase SQL Editor
// ============================================================
const adminDb = {
  // Hapus 1 baris by ID
  async delete(table, id) {
    const { data, error } = await db.rpc('admin_delete_by_id', {
      p_table: table, p_id: id
    });
    return { data, error };
  },

  // Hapus banyak baris by array of IDs
  async batchDelete(table, ids) {
    const { data, error } = await db.rpc('admin_batch_delete', {
      p_table: table, p_ids: ids.map(id => parseInt(id, 10))
    });
    return { data, error };
  },

  // Update 1 baris by ID
  async update(table, id, setObj) {
    const { data, error } = await db.rpc('admin_update_by_id', {
      p_table: table, p_id: id, p_set: setObj
    });
    return { data, error };
  },

  // Insert array of objects
  async insert(table, dataArr) {
    const hasil = [];
    for (const item of dataArr) {
      const { data, error } = await db.rpc('admin_insert', {
        p_table: table, p_data: item
      });
      if (error) return { data: null, error };
      // RPC return { success: true, data: {id:..., ...} }
      if (data && data.data) hasil.push(data.data);
    }
    return { data: hasil, error: null };
  },

  // Panggil RPC function (untuk koreksi_dan_submit dll)
  async rpc(fn, params) {
    const { data, error } = await db.rpc(fn, params);
    return { data, error };
  }
};
