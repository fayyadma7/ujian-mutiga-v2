// ============================================================
// admin-db.js — Admin SQL functions via admin-proxy Edge Function
// Operasi DELETE/UPDATE/INSERT via service_role key di server-side.
// Auth: mengirim guru session (id + username) sebagai validasi.
// Hanya guru aktif yang bisa mengakses proxy ini.
// UPDATE 2026-09: tambah auto-fallback via RPC jika proxy lama (Unknown action)
// ============================================================

const ADMIN_PROXY_URL = 'https://bkecjfrwqocguyvjymkn.supabase.co/functions/v1/admin-proxy';
const ADMIN_PROXY_ANON_KEY = 'sb_publishable_4sQqxzUTiVhuf2h4SZCqNA_txpH0J8C';

// — Global loader untuk delay — hanya tampil jika >300ms biar ga kedip untuk yang cepat
let _globalLoaderTimer = null;
let _globalLoaderCount = 0;
function showGlobalLoader(msg, opts){
  try{
    opts = opts || {};
    if(opts.silent) return;
    const el=document.getElementById('global-loader');
    const txt=document.getElementById('global-loader-text');
    if(txt && msg) txt.textContent=msg;
    if(!el) return;
    _globalLoaderCount++;
    if(_globalLoaderTimer) clearTimeout(_globalLoaderTimer);
    const delay = opts.immediate ? 0 : 300;
    if(delay===0){ el.classList.add('show'); el.style.display='flex'; }
    else _globalLoaderTimer=setTimeout(()=>{ el.classList.add('show'); el.style.display='flex'; }, delay);
  }catch(e){}
}
function hideGlobalLoader(opts){
  try{
    opts = opts || {};
    if(opts.silent) return;
    _globalLoaderCount=Math.max(0,_globalLoaderCount-1);
    if(_globalLoaderCount>0) return;
    if(_globalLoaderTimer) clearTimeout(_globalLoaderTimer);
    _globalLoaderTimer=null;
    const el=document.getElementById('global-loader');
    if(!el) return;
    el.classList.remove('show');
    setTimeout(()=>{ if(!el.classList.contains('show')) el.style.display='none'; }, 220);
  }catch(e){}
}
function withBtnLoading(btn, msg){
  if(!btn) return ()=>{};
  const origHTML=btn.innerHTML;
  const origDis=btn.disabled;
  btn.classList.add('is-loading');
  btn.disabled=true;
  if(msg) btn.innerHTML=`<i class="fas fa-spinner fa-spin"></i> ${msg}`;
  return ()=>{
    btn.classList.remove('is-loading');
    btn.disabled=origDis;
    btn.innerHTML=origHTML;
  };
}
// expose untuk dipakai di admin-*.js
try{ window.showGlobalLoader=showGlobalLoader; window.hideGlobalLoader=hideGlobalLoader; window.withBtnLoading=withBtnLoading; }catch(e){}

// Ambil session dari localStorage
function getGuruSession() {
  try { return JSON.parse(localStorage.getItem('guru_session')); } catch { return null; }
}

async function callProxy(action, body, opts) {
  const session = getGuruSession();
  if (!session || !session.id) {
    return { data: null, error: new Error('Silakan login terlebih dahulu') };
  }
  opts = opts || {};
  // hapus harus instan tanpa delay 300ms
  if(['delete','batch-delete'].includes(action)) opts.immediate = true;
  const _msgMap={ 'delete':'Menghapus...','batch-delete':'Menghapus...','update':'Menyimpan...','insert':'Menyimpan...','rename-mapel':'Memproses...','update-guru-profile':'Menyimpan...','update-guru-password':'Menyimpan...','rpc':'Memproses...' };
  showGlobalLoader(_msgMap[action]||'Memproses...', opts);

  try {
    const res = await fetch(ADMIN_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ADMIN_PROXY_ANON_KEY,
        'Authorization': `Bearer ${ADMIN_PROXY_ANON_KEY}`,
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
  } finally {
    hideGlobalLoader(opts);
  }
}

const adminDb = {
  // Hapus 1 baris by ID
  async delete(table, id, opts) {
    return callProxy('delete', { table, id }, opts);
  },

  // Hapus banyak baris by array of IDs
  async batchDelete(table, ids, opts) {
    return callProxy('batch-delete', { table, data: { ids } }, opts);
  },

  // Update 1 baris by ID
  async update(table, id, setObj, opts) {
    return callProxy('update', { table, id, data: { set: setObj } }, opts);
  },

  // Update banyak baris by filter (untuk rename mapel)
  async updateWhere(table, filter, setObj, opts) {
    return callProxy('update', { table, filter, data: { set: setObj } }, opts);
  },

  // Rename mapel di bank_soal (RBAC: admin semua, guru hanya miliknya)
  async renameMapel(oldMapel, newMapel, opts) {
    return callProxy('rename-mapel', { table: 'bank_soal', data: { oldMapel, newMapel } }, opts);
  },

  // Update profil guru (nama & username) — self atau admin
  // Auto-fallback via rpc jika proxy lama (Unknown action)
  async updateGuruProfile(targetId, nama, username, opts) {
    const res = await callProxy('update-guru-profile', { data: { target_id: targetId, nama, username } }, opts);
    // jika proxy belum ter-deploy dan mengembalikan Unknown action, coba fallback langsung via RPC proxy
    if (res && res.error && String(res.error.message || res.error).includes('Unknown action')) {
      // coba via generic rpc proxy (tetap lewat admin-proxy tapi action=rpc)
      const session = getGuruSession();
      if (session) {
        const rpcRes = await callProxy('rpc', { data: { function_name: 'guru_update_profil', params: { p_actor_id: session.id, p_target_id: targetId, p_nama: nama, p_username: username } } }, opts);
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
  async updateGuruPassword(targetId, oldPassword, newPassword, opts) {
    const res = await callProxy('update-guru-password', { data: { target_id: targetId, oldPassword, newPassword } }, opts);
    if (res && res.error && String(res.error.message || res.error).includes('Unknown action')) {
      const session = getGuruSession();
      if (session) {
        // fallback via rpc proxy — tetap aman karena lewat service_role di edge
        const rpcRes = await callProxy('rpc', { data: { function_name: 'guru_ganti_password', params: { p_actor_id: session.id, p_target_id: targetId, p_old: oldPassword || '', p_new: newPassword } } }, opts);
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
  async insert(table, dataArr, opts) {
    return callProxy('insert', { table, data: dataArr }, opts);
  },

  // Panggil RPC function (untuk koreksi_dan_submit dll)
  async rpc(fn, params, opts) {
    return callProxy('rpc', { data: { function_name: fn, params } }, opts);
  }
};
