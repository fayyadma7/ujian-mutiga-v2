// @ts-nocheck
// ============================================================
// admin-guru.js — Akun Guru Section
// Functions: loadDataGuru, loadGuruList, loadPendingList,
//            hapusGuruAkun, setujuiGuruAkun,
//            tolakGuruAkun, toggleGuruStatus, waktuRelatif, badgeStatus
//            + Edit Profil & Password (admin)
// ============================================================

function waktuRelatif(tgl) {
    if (!tgl) return '';
    const diffMs = Date.now() - new Date(tgl).getTime();
    const dtk = Math.floor(diffMs / 1000);
    if (dtk < 60) return 'baru saja';
    const mnt = Math.floor(dtk / 60);
    if (mnt < 60) return mnt + ' menit lalu';
    const jam = Math.floor(mnt / 60);
    if (jam < 24) return jam + ' jam lalu';
    const hari = Math.floor(jam / 24);
    if (hari < 7) return hari + ' hari lalu';
    return new Date(tgl).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function badgeStatus(status, lastSeen) {
    const isTimedOut = status === 'online' && lastSeen && (Date.now() - new Date(lastSeen).getTime() > 5 * 60 * 1000);
    const trulyOnline = status === 'online' && !isTimedOut;
    if (trulyOnline) {
        return '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);color:#34d399;"><i class="fas fa-circle" style="font-size:6px;color:#10b981;filter:drop-shadow(0 0 4px #10b981);"></i> Online</span>';
    }
    if (lastSeen) {
        return '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:rgba(148,163,184,0.05);border:1px solid rgba(148,163,184,0.12);color:#94a3b8;" title="Terakhir online: ' + new Date(lastSeen).toLocaleString('id-ID') + '"><i class="fas fa-circle" style="font-size:6px;color:#64748b;"></i> ' + waktuRelatif(lastSeen) + '</span>';
    }
    return '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.15);color:#94a3b8;"><i class="fas fa-circle" style="font-size:6px;color:#64748b;"></i> Offline</span>';
}

async function loadDataGuru() {
    loadGuruList();
    loadPendingList();
}

async function loadGuruList() {
    const s = getGuruSession();
    if (!s || s.isAdmin !== true) return;
    try {
        const { data, error } = await db.rpc('guru_list');
        const tbody = document.getElementById('guruTableBody');
        if (error) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#fca5a5;">Gagal memuat data</td></tr>'; return; }
        const list = (data && data.success && data.data) ? data.data : [];
        window._guruCache = list;
        document.getElementById('guruTotal').textContent = list.length;
        document.getElementById('guruAktif').textContent = list.filter(g => g.is_active).length;

        if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:rgba(255,255,255,0.3);"><i class="fas fa-users" style="font-size:24px;display:block;margin-bottom:8px;opacity:0.5;"></i>Belum ada guru terdaftar</td></tr>';
            return;
        }
        let html = '';
        list.forEach((g, i) => {
            const isGuruAdmin = (g.role === 'admin');
            const escNama = (g.nama||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');
            html += '<tr>' +
                '<td data-label="No" style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);color:rgba(255,255,255,0.35);text-align:center;">' + (i+1) + '</td>' +
                '<td data-label="Nama" style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:left;"><strong>' + g.nama + '</strong><div style="font-size:11px;color:rgba(255,255,255,0.35);">ID: '+g.id+'</div></td>' +
                '<td data-label="Username" style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);color:rgba(255,255,255,0.4);font-size:12px;text-align:center;">@' + g.username + '</td>' +
                '<td data-label="Role" style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:center;"><span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;background:' + (isGuruAdmin ? 'rgba(245,158,11,0.12)' : 'rgba(59,130,246,0.12)') + ';border:1px solid ' + (isGuruAdmin ? 'rgba(245,158,11,0.25)' : 'rgba(59,130,246,0.25)') + ';color:' + (isGuruAdmin ? '#fbbf24' : '#93c5fd') + ';"><i class="fas fa-' + (isGuruAdmin ? 'crown' : 'user-graduate') + '"></i>' + (isGuruAdmin ? 'Admin' : 'Guru') + '</span></td>' +
                '<td data-label="Status" style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:center;"><div style="display:flex;flex-direction:column;gap:4px;align-items:center;">' +
                    '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;background:' + (g.is_active ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)') + ';border:1px solid ' + (g.is_active ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)') + ';color:' + (g.is_active ? '#86efac' : '#fca5a5') + ';"><i class="fas fa-' + (g.is_active ? 'check-circle' : 'times-circle') + '"></i>' + (g.is_active ? 'Aktif' : 'Nonaktif') + '</span>' +
                    badgeStatus(isGuruAdmin ? 'online' : g.status, isGuruAdmin ? new Date().toISOString() : g.last_seen) +
                '</div></td>' +
                '<td data-label="Aksi" style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:center;"><div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;">' +
                    '<button onclick="bukaModalEditGuru('+g.id+')" title="Edit nama & password" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid rgba(59,130,246,0.25);background:rgba(59,130,246,0.1);color:#93c5fd;font-family:\'Inter\',sans-serif;">' +
                        '<i class="fas fa-pen"></i> Edit</button>' +
                    '<button onclick="toggleGuruStatus(' + g.id + ',' + !g.is_active + ')" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.6);font-family:\'Inter\',sans-serif;">' +
                        '<i class="fas fa-' + (g.is_active ? 'pause' : 'play') + '"></i> ' + (g.is_active ? 'Nonaktif' : 'Aktif') + '</button>' +
                    '<button onclick="hapusGuruAkun(' + g.id + ')" title="Hapus" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid rgba(239,68,68,0.2);background:rgba(239,68,68,0.08);color:#fca5a5;font-family:\'Inter\',sans-serif;">' +
                        '<i class="fas fa-trash"></i></button>' +
                '</div></td>' +
            '</tr>';
        });
        tbody.innerHTML = html;
    } catch (e) {
        document.getElementById('guruTableBody').innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#fca5a5;">Error: ' + e.message + '</td></tr>';
    }
}

async function loadPendingList() {
    const s = getGuruSession();
    if (!s || s.isAdmin !== true) return;
    try {
        const { data, error } = await db.rpc('guru_list_pending');
        const tbody = document.getElementById('pendingTableBody');
        if (error) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#fca5a5;">Gagal memuat data</td></tr>'; return; }
        const list = (data && data.success && data.data) ? data.data : [];
        document.getElementById('guruPending').textContent = list.length;

        if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:rgba(255,255,255,0.3);"><i class="fas fa-check-circle" style="font-size:24px;display:block;margin-bottom:8px;opacity:0.5;color:#86efac;"></i>Tidak ada pendaftaran menunggu</td></tr>';
            return;
        }
        let html = '';
        list.forEach((p, i) => {
            const tgl = p.created_at ? new Date(p.created_at).toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
            html += '<tr>' +
                '<td data-label="No" style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);color:rgba(255,255,255,0.35);text-align:center;">' + (i+1) + '</td>' +
                '<td data-label="Nama" style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:left;"><strong>' + p.nama + '</strong></td>' +
                '<td data-label="Username" style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);color:rgba(255,255,255,0.4);font-size:12px;text-align:center;">' + p.username + '</td>' +
                '<td data-label="Tanggal Daftar" style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);color:rgba(255,255,255,0.4);font-size:12px;text-align:center;">' + tgl + '</td>' +
                '<td data-label="Aksi" style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:center;"><div style="display:flex;gap:4px;justify-content:center;">' +
                    '<button onclick="setujuiGuruAkun(' + p.id + ')" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid rgba(34,197,94,0.25);background:rgba(34,197,94,0.1);color:#86efac;font-family:\'Inter\',sans-serif;"><i class="fas fa-check"></i> Setujui</button>' +
                    '<button onclick="tolakGuruAkun(' + p.id + ')" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid rgba(239,68,68,0.2);background:rgba(239,68,68,0.08);color:#fca5a5;font-family:\'Inter\',sans-serif;"><i class="fas fa-times"></i> Tolak</button>' +
                '</div></td>' +
            '</tr>';
        });
        tbody.innerHTML = html;
    } catch (e) {
        document.getElementById('pendingTableBody').innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#fca5a5;">Error: ' + e.message + '</td></tr>';
    }
}

async function setujuiGuruAkun(id) {
    const s = getGuruSession();
    if (!s || s.isAdmin !== true) { showToast('Akses ditolak. Hanya Admin.', 'error'); return; }
    try {
        const { data, error } = await db.rpc('guru_setujui', { p_registrasi_id: id });
        if (error || !data || !data.success) { Swal.fire({ icon: 'error', title: 'Gagal', text: error ? error.message : (data && data.error ? data.error : 'Error'), background: 'rgba(15,23,42,0.95)', color: '#f1f5f9', confirmButtonColor: '#3B82F6' }); return; }
        Swal.fire({ icon: 'success', title: 'Berhasil', text: 'Guru berhasil disetujui', timer: 1500, showConfirmButton: false, background: 'rgba(15,23,42,0.95)', color: '#f1f5f9' });
        loadDataGuru();
    } catch (e) { Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: 'rgba(15,23,42,0.95)', color: '#f1f5f9' }); }
}

async function tolakGuruAkun(id) {
    const s = getGuruSession();
    if (!s || s.isAdmin !== true) { showToast('Akses ditolak. Hanya Admin.', 'error'); return; }
    try {
        const { data, error } = await db.rpc('guru_tolak', { p_registrasi_id: id });
        if (error || !data || !data.success) { Swal.fire({ icon: 'error', title: 'Gagal', text: error ? error.message : (data && data.error ? data.error : 'Error'), background: 'rgba(15,23,42,0.95)', color: '#f1f5f9', confirmButtonColor: '#3B82F6' }); return; }
        Swal.fire({ icon: 'info', title: 'Ditolak', text: 'Pendaftaran ditolak', timer: 1500, showConfirmButton: false, background: 'rgba(15,23,42,0.95)', color: '#f1f5f9' });
        loadDataGuru();
    } catch (e) { Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: 'rgba(15,23,42,0.95)', color: '#f1f5f9' }); }
}

async function toggleGuruStatus(id, active) {
    const s = getGuruSession();
    if (!s || s.isAdmin !== true) { showToast('Akses ditolak. Hanya Admin.', 'error'); return; }
    try {
        const { data, error } = await db.rpc('guru_toggle_active', { p_guru_id: id, p_active: active });
        if (error || !data || !data.success) { Swal.fire({ icon: 'error', title: 'Gagal', text: error ? error.message : (data && data.error ? data.error : 'Error'), background: 'rgba(15,23,42,0.95)', color: '#f1f5f9', confirmButtonColor: '#3B82F6' }); return; }
        loadGuruList();
    } catch (e) { Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: 'rgba(15,23,42,0.95)', color: '#f1f5f9' }); }
}

async function hapusGuruAkun(id) {
    const s = getGuruSession();
    if (!s || s.isAdmin !== true) { showToast('Akses ditolak. Hanya Admin.', 'error'); return; }
    Swal.fire({
        title: 'Hapus Guru?', text: 'Data guru akan dihapus permanen',
        icon: 'warning', showCancelButton: true, confirmButtonColor: '#EF4444', cancelButtonColor: '#6B7280',
        confirmButtonText: 'Ya, Hapus', cancelButtonText: 'Batal',
        background: 'rgba(15,23,42,0.95)', color: '#f1f5f9'
    }).then(async (res) => {
        if (!res.isConfirmed) return;
        try {
            const { data, error } = await db.rpc('guru_hapus', { p_guru_id: id });
            if (error || !data || !data.success) { Swal.fire({ icon: 'error', title: 'Gagal', text: error ? error.message : (data && data.error ? data.error : 'Error'), background: 'rgba(15,23,42,0.95)', color: '#f1f5f9', confirmButtonColor: '#3B82F6' }); return; }
            Swal.fire({ icon: 'success', title: 'Berhasil', text: 'Guru berhasil dihapus', timer: 1500, showConfirmButton: false, background: 'rgba(15,23,42,0.95)', color: '#f1f5f9' });
            loadDataGuru();
        } catch (e) { Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: 'rgba(15,23,42,0.95)', color: '#f1f5f9' }); }
    });
}

function hapusGuru(id) { return hapusGuruAkun(id); }

// ==================== ADMIN EDIT GURU (rename + reset password) ====================
let _adminEditGuruId = null;
function bukaModalEditGuru(id){
    const list = window._guruCache || [];
    const g = list.find(x=> String(x.id)===String(id));
    if(!g){ showToast('Data guru tidak ditemukan','error'); return; }
    const s = getGuruSession();
    if(!s || s.isAdmin!==true){ showToast('Hanya admin','error'); return; }
    _adminEditGuruId = g.id;
    const namaEl = document.getElementById('admin-edit-nama');
    const userEl = document.getElementById('admin-edit-username');
    const passEl = document.getElementById('admin-edit-password');
    const confEl = document.getElementById('admin-edit-password-confirm');
    if(namaEl) namaEl.value = g.nama || '';
    if(userEl) userEl.value = g.username || '';
    if(passEl) passEl.value = '';
    if(confEl) confEl.value = '';
    ['admin-edit-password','admin-edit-password-confirm'].forEach(id=>{ try{_resetPwdAdmin(id,'#modalEditGuruAdmin')}catch(_){}});
    const titleEl = document.getElementById('admin-edit-title');
    if(titleEl) titleEl.textContent = 'Edit Akun: '+(g.nama||'');
    const hintEl = document.getElementById('admin-edit-hint');
    if(hintEl) hintEl.textContent = '@'+g.username+' \u00B7 '+(g.role==='admin'?'Admin':'Guru')+' \u00B7 ID '+g.id;
    const statusEl = document.getElementById('admin-edit-status');
    if(statusEl) statusEl.innerHTML='';
    const infoPass = document.getElementById('admin-edit-pass-info');
    if(infoPass) infoPass.textContent = 'Kosongkan jika tidak ingin ganti password. Minimal 6 karakter.';
    const modal = document.getElementById('modalEditGuruAdmin');
    if(modal) modal.style.display='flex';
    setTimeout(()=>{ if(namaEl) namaEl.focus(); },80);
}
function tutupModalEditGuru(){
    const modal = document.getElementById('modalEditGuruAdmin');
    if(modal) modal.style.display='none';
    _adminEditGuruId = null;
    ['admin-edit-password','admin-edit-password-confirm'].forEach(id=>{ try{_resetPwdAdmin(id,'#modalEditGuruAdmin')}catch(_){}});
}
async function simpanEditGuru(){
    const id = _adminEditGuruId;
    if(!id){ showToast('Pilih guru terlebih dahulu','error'); return; }
    const nama = (document.getElementById('admin-edit-nama')?.value||'').trim();
    const username = (document.getElementById('admin-edit-username')?.value||'').trim();
    const newPass = document.getElementById('admin-edit-password')?.value || '';
    const confPass = document.getElementById('admin-edit-password-confirm')?.value || '';
    const btn = document.getElementById('btnSimpanEditGuru');
    const statusEl = document.getElementById('admin-edit-status');
    const s = getGuruSession();
    if(!nama || nama.length < 3){ showToast('Nama minimal 3 karakter','error'); return; }
    if(nama.length > 60){ showToast('Nama maksimal 60','error'); return; }
    if(!username || username.length < 3){ showToast('Username minimal 3','error'); return; }
    if(username.length > 30){ showToast('Username maksimal 30','error'); return; }
    if(!/^[a-zA-Z0-9._@-]+$/.test(username)){ showToast('Username hanya boleh huruf/angka/@._-','error'); return; }
    if(newPass){
        if(newPass.length < 6){ showToast('Password minimal 6','error'); return; }
        if(newPass.length > 72){ showToast('Password maksimal 72','error'); return; }
        if(newPass !== confPass){ showToast('Konfirmasi password tidak cocok','error'); return; }
    }
    if(btn){ btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Menyimpan...'; }
    if(statusEl) statusEl.innerHTML='';
    try{
        const orig = (window._guruCache||[]).find(x=> String(x.id)===String(id));
        const needProfil = !orig || orig.nama !== nama || orig.username !== username;
        let profilErr = null;
        if(needProfil){
            const res1 = await adminDb.updateGuruProfile(id, nama, username);
            if(res1 && res1.error) profilErr = res1.error.message || res1.error;
            else if(res1 && res1.data && res1.data.error) profilErr = res1.data.error;
            else if(res1 && res1.data && res1.data.success===false) profilErr = res1.data.error || 'Gagal update profil';
            // cek apakah data berisi error jsonb
            if(profilErr){
                if(statusEl) statusEl.innerHTML='<span style="color:#fca5a5;">'+profilErr+'</span>';
                showToast(profilErr,'error');
                if(btn){ btn.disabled=false; btn.innerHTML='<i class="fas fa-save"></i> Simpan Perubahan'; }
                return;
            }
        }
        if(newPass){
            const res2 = await adminDb.updateGuruPassword(id, null, newPass);
            let pErr=null;
            if(res2 && res2.error) pErr = res2.error.message || res2.error;
            else if(res2 && res2.data && res2.data.error) pErr = res2.data.error;
            else if(res2 && res2.data && res2.data.success===false) pErr = res2.data.error || 'Gagal ganti password';
            // jika Unknown action, beri instruksi deploy yang jelas
            if(pErr && String(pErr).includes('Unknown action')){
                pErr = 'Edge function belum ter-deploy. Jalankan: npx supabase functions deploy admin-proxy --project-ref bkecjfrwqocguyvjymkn lalu npx supabase db push — atau refresh halaman setelah deploy.';
            }
            if(pErr){
                // jika profil sudah terupdate, tetap informasikan
                if(statusEl) statusEl.innerHTML='<span style="color:#fca5a5;">Profil tersimpan, tapi password gagal: '+pErr+'</span>';
                showToast('Password gagal: '+pErr,'error');
                loadGuruList();
                if(btn){ btn.disabled=false; btn.innerHTML='<i class="fas fa-save"></i> Simpan Perubahan'; }
                // jika edit diri sendiri, tetap update session untuk profil
                if(s && String(s.id)===String(id) && needProfil){
                    s.nama=nama; s.username=username;
                    localStorage.setItem('guru_session', JSON.stringify(s));
                    try{ sessionStorage.setItem('guru_session_backup', JSON.stringify(s)); }catch(_){}
                    if(typeof updateWelcomeGreeting==='function') updateWelcomeGreeting();
                    if(typeof pasangNavigasiRole==='function') pasangNavigasiRole();
                }
                return;
            }
        }
        showToast('Akun guru berhasil diperbarui','success');
        if(statusEl) statusEl.innerHTML='<span style="color:#86efac;"><i class="fas fa-check-circle"></i> Berhasil diperbarui</span>';
        // update session jika edit diri sendiri
        if(s && String(s.id)===String(id)){
            s.nama=nama; s.username=username;
            localStorage.setItem('guru_session', JSON.stringify(s));
            try{ sessionStorage.setItem('guru_session_backup', JSON.stringify(s)); }catch(_){}
            if(typeof updateWelcomeGreeting==='function') updateWelcomeGreeting();
            if(typeof pasangNavigasiRole==='function') pasangNavigasiRole();
        }
        setTimeout(()=>{ tutupModalEditGuru(); loadGuruList(); }, 700);
    }catch(e){
        const msg = e.message || 'Gagal menyimpan';
        if(statusEl) statusEl.innerHTML='<span style="color:#fca5a5;">'+msg+'</span>';
        showToast(msg,'error');
    }finally{
        if(btn){ btn.disabled=false; btn.innerHTML='<i class="fas fa-save"></i> Simpan Perubahan'; }
    }
}
// tutup modal saat klik backdrop
document.addEventListener('click', function(e){
    const m1 = document.getElementById('modalEditGuruAdmin');
    if(m1 && e.target===m1) tutupModalEditGuru();
    const m2 = document.getElementById('modalEditProfilSaya');
    if(m2 && e.target===m2 && typeof tutupModalEditProfilSaya==='function') tutupModalEditProfilSaya();
});
document.addEventListener('keydown', function(e){
    if(e.key==='Escape'){
        const m1=document.getElementById('modalEditGuruAdmin');
        if(m1 && m1.style.display==='flex') tutupModalEditGuru();
        const m2=document.getElementById('modalEditProfilSaya');
        if(m2 && m2.style.display==='flex' && typeof tutupModalEditProfilSaya==='function') tutupModalEditProfilSaya();
    }
});
