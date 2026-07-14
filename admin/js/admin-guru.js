// @ts-nocheck
// ============================================================
// admin-guru.js — Akun Guru Section
// Functions: loadDataGuru, loadGuruList, loadPendingList,
//            daftarGuruAdmin, hapusGuruAkun, setujuiGuruAkun,
//            tolakGuruAkun, toggleGuruStatus, bukaModalDaftarGuru,
//            tutupModalDaftarGuru, waktuRelatif, badgeStatus
// ============================================================

function bukaModalDaftarGuru() {
    document.getElementById('daftarNama').value = '';
    document.getElementById('daftarUsername').value = '';
    document.getElementById('daftarPassword').value = '';
    document.getElementById('daftarStatus').textContent = '';
    document.getElementById('modalDaftarGuru').style.display = 'flex';
}

function tutupModalDaftarGuru() {
    document.getElementById('modalDaftarGuru').style.display = 'none';
}

async function daftarGuruAdmin() {
    const nama = document.getElementById('daftarNama').value.trim();
    const username = document.getElementById('daftarUsername').value.trim();
    const password = document.getElementById('daftarPassword').value;
    const statusEl = document.getElementById('daftarStatus');

    if (!nama || !username || !password) { statusEl.innerHTML = '<span style="color:#fca5a5;">Harap isi semua field</span>'; return; }
    if (username.length < 3) { statusEl.innerHTML = '<span style="color:#fca5a5;">Username minimal 3 karakter</span>'; return; }
    if (password.length < 6) { statusEl.innerHTML = '<span style="color:#fca5a5;">Password minimal 6 karakter</span>'; return; }

    const btn = document.querySelector('#modalDaftarGuru button');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mengirim...';
    statusEl.innerHTML = '';

    try {
        const { data, error } = await db.rpc('guru_daftar', { p_username: username, p_password: password, p_nama: nama });
        if (error || !data || !data.success) {
            statusEl.innerHTML = '<span style="color:#fca5a5;">' + ((error ? error.message : (data && data.error ? data.error : 'Pendaftaran gagal'))) + '</span>';
            btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Kirim Pendaftaran';
            return;
        }
        statusEl.innerHTML = '<span style="color:#86efac;font-weight:600;">' + data.message + '</span>';
        btn.innerHTML = '<i class="fas fa-check"></i> Terkirim!';
        btn.disabled = false;
        setTimeout(() => { document.getElementById('modalDaftarGuru').style.display = 'none'; }, 3000);
    } catch (e) {
        statusEl.innerHTML = '<span style="color:#fca5a5;">' + (e.message || 'Terjadi kesalahan') + '</span>';
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Kirim Pendaftaran';
    }
}

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
        document.getElementById('guruTotal').textContent = list.length;
        document.getElementById('guruAktif').textContent = list.filter(g => g.is_active).length;

        if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:rgba(255,255,255,0.3);"><i class="fas fa-users" style="font-size:24px;display:block;margin-bottom:8px;opacity:0.5;"></i>Belum ada guru terdaftar</td></tr>';
            return;
        }
        let html = '';
        list.forEach((g, i) => {
            const isGuruAdmin = (g.role === 'admin');
            html += '<tr>' +
                '<td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);color:rgba(255,255,255,0.35);text-align:center;">' + (i+1) + '</td>' +
                '<td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:left;"><strong>' + g.nama + '</strong></td>' +
                '<td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);color:rgba(255,255,255,0.4);font-size:12px;text-align:center;">' + g.username + '</td>' +
                '<td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:center;"><span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;background:' + (isGuruAdmin ? 'rgba(245,158,11,0.12)' : 'rgba(59,130,246,0.12)') + ';border:1px solid ' + (isGuruAdmin ? 'rgba(245,158,11,0.25)' : 'rgba(59,130,246,0.25)') + ';color:' + (isGuruAdmin ? '#fbbf24' : '#93c5fd') + ';"><i class="fas fa-' + (isGuruAdmin ? 'crown' : 'user-graduate') + '"></i>' + (isGuruAdmin ? 'Admin' : 'Guru') + '</span></td>' +
                '<td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:center;"><div style="display:flex;flex-direction:column;gap:4px;align-items:center;">' +
                    '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;background:' + (g.is_active ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)') + ';border:1px solid ' + (g.is_active ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)') + ';color:' + (g.is_active ? '#86efac' : '#fca5a5') + ';"><i class="fas fa-' + (g.is_active ? 'check-circle' : 'times-circle') + '"></i>' + (g.is_active ? 'Aktif' : 'Nonaktif') + '</span>' +
                    badgeStatus(isGuruAdmin ? 'online' : g.status, isGuruAdmin ? new Date().toISOString() : g.last_seen) +
                '</div></td>' +
                '<td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:center;"><div style="display:flex;gap:4px;justify-content:center;">' +
                    '<button onclick="toggleGuruStatus(' + g.id + ',' + !g.is_active + ')" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.6);font-family:\'Inter\',sans-serif;">' +
                        '<i class="fas fa-' + (g.is_active ? 'pause' : 'play') + '"></i> ' + (g.is_active ? 'Nonaktifkan' : 'Aktifkan') + '</button>' +
                    '<button onclick="hapusGuruAkun(' + g.id + ')" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid rgba(239,68,68,0.2);background:rgba(239,68,68,0.08);color:#fca5a5;font-family:\'Inter\',sans-serif;">' +
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
                '<td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);color:rgba(255,255,255,0.35);text-align:center;">' + (i+1) + '</td>' +
                '<td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:left;"><strong>' + p.nama + '</strong></td>' +
                '<td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);color:rgba(255,255,255,0.4);font-size:12px;text-align:center;">' + p.username + '</td>' +
                '<td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);color:rgba(255,255,255,0.4);font-size:12px;text-align:center;">' + tgl + '</td>' +
                '<td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:center;"><div style="display:flex;gap:4px;justify-content:center;">' +
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
