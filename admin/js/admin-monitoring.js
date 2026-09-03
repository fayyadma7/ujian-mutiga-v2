// @ts-nocheck
// ============================================================
// admin-monitoring.js — Live Monitoring Section
// Functions: loadMonitoring, startRealtimeMonitoring, stopMonitoring,
//            resetMonitoringFilter, clearFilterMonitoring, clearSortMonitoring,
//            updateCounts, toggleSortMonitoring, sortMonitoringData,
//            updateSortIndicators, populateFilterKelas,
//            toggleDatePicker, onDateChange, applyDateFilter, clearDateFilter,
//            bulkActionMonitoring, hapusDataNilai, handleUploadDarurat
// ============================================================

const violationTracker = new Map();
let monitoringChannel = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
function scheduleReconnect(){
  if(reconnectTimer) clearTimeout(reconnectTimer);
  const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts++));
  console.warn(`[monitoring] reconnect ${reconnectAttempts} in ${delay}ms`);
  reconnectTimer = setTimeout(()=> startRealtimeMonitoring(), delay);
}
function startRealtimeMonitoring() {
    if(reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer=null; }
    if (monitoringChannel) { try{ db.removeChannel(monitoringChannel);}catch(e){} monitoringChannel = null; }
    monitoringChannel = db.channel('monitoring-live-v2');
    const seenIds = new Set();

    monitoringChannel = monitoringChannel
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'jawaban_ujian' },
            payload => {
                const s = payload.new;
                const prev = payload.old || {};
                const ev = payload.eventType;

                const overlay = document.getElementById('landingOverlay');
                if (overlay && typeof updateLandingSiswaAktif === 'function') updateLandingSiswaAktif();

                if (ev === 'INSERT' && s.id && seenIds.has(s.id)) {
                    if ((s.status || '').startsWith('SELESAI')) { seenIds.delete(s.id); violationTracker.delete(s.id); }
                    return;
                }
                if (ev === 'INSERT' && s.id && !((s.status || '').startsWith('SELESAI'))) seenIds.add(s.id);

                if (ev === 'UPDATE') {
                    const currentPlg = parseInt(s.pelanggaran) || 0;
                    const prevPlg = violationTracker.get(s.id) || 0;
                    if (currentPlg > prevPlg) {
                        if (!document.hidden) showToast(`Pelanggaran! ${s.nama} (${s.kelas}) — ${currentPlg}x`, 'plg');
                        violationTracker.set(s.id, currentPlg);
                    }
                    if ((s.status || '').startsWith('SELESAI')) {
                        if (!document.hidden) showToast(`${s.nama} (${s.kelas}) — Selesai!`, 'selesai');
                        if (typeof loadRecentActivity === 'function') loadRecentActivity();
                        seenIds.delete(s.id); violationTracker.delete(s.id);
                    }
                }
                if (ev === 'INSERT') {
                    if ((s.status || '').startsWith('SELESAI')) {
                        if (typeof loadRecentActivity === 'function') loadRecentActivity();
                        seenIds.delete(s.id); violationTracker.delete(s.id);
                    }
                }

                let perluReload = false;
                if (ev === 'INSERT') perluReload = true;
                else if (ev === 'UPDATE') {
                    const statusBerubah = (prev.status || '') !== (s.status || '');
                    const pelanggaranBertambah = (parseInt(s.pelanggaran) || 0) > (parseInt(prev.pelanggaran) || 0);
                    if (statusBerubah || pelanggaranBertambah) perluReload = true;
                }
                if (perluReload && document.getElementById('monitoring').classList.contains('active')) {
                    if (window._monDebounce) clearTimeout(window._monDebounce);
                    window._monDebounce = setTimeout(() => { loadMonitoring(); }, 1000);
                }
            }
        )
        .subscribe((status, err) => {
            if (status === 'SUBSCRIBED') {
                reconnectAttempts = 0;
                console.log('✅ Realtime monitoring terhubung!');
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                console.error('❌ Realtime monitoring gagal:', status, err || '(no err) — cek publication & RLS');
                if(status==='CLOSED' && !err) console.warn('Hint: publication supabase_realtime belum ada — sudah difix via migration 20260911000000');
                scheduleReconnect();
            } else {
                console.warn('Realtime status:', status, err);
            }
        });
}

function stopMonitoring() {
    if(reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer=null; }
    if (monitoringChannel) { try{ db.removeChannel(monitoringChannel);}catch(e){} monitoringChannel = null; }
}

async function populateFilterKelas() {
    const selectKelas = document.getElementById('filter-kelas-monitoring');
    const selectMapel = document.getElementById('filter-mapel-monitoring');
    if (!selectKelas || !selectMapel) return;
    // Filter HARUS dari data master: kelas dari tabel kelas, mapel dari bank_soal (bukan dari jawaban_ujian)
    let allowedMapelList = null;
    try {
        const sesi = typeof getGuruSession === 'function' ? getGuruSession() : null;
        const isAdmin = sesi && sesi.isAdmin === true;
        const guruId = sesi ? sesi.id : null;
        if (!isAdmin && guruId) {
            const { data: mySoal } = await db.from('bank_soal').select('mapel').eq('created_by', guruId);
            if (mySoal) {
                const s = new Set((mySoal || []).map(r => (r.mapel || '').trim()).filter(Boolean));
                allowedMapelList = [...s].sort();
            } else allowedMapelList = [];
        }
    } catch (_) { allowedMapelList = null; }

    let kelasList = [];
    try {
        const { data: kelasRaw } = await db.from('kelas').select('nama').eq('is_aktif', true).order('nama', { ascending: true });
        const s = new Set();
        (kelasRaw || []).forEach(r => { if (r.nama) s.add(r.nama.trim()); });
        kelasList = [...s].sort();
    } catch (_) { kelasList = []; }

    let mapelList = [];
    try {
        if (allowedMapelList !== null) {
            mapelList = allowedMapelList;
        } else {
            const { data: mapelRaw } = await db.from('bank_soal').select('mapel').order('mapel', { ascending: true });
            const s = new Set();
            (mapelRaw || []).forEach(r => { if (r.mapel) s.add(r.mapel.trim()); });
            mapelList = [...s].sort();
        }
    } catch (_) { mapelList = allowedMapelList || []; }

    const prevKelas = selectKelas.value;
    const prevMapel = selectMapel.value;

    selectKelas.innerHTML = '<option value="">Semua Kelas</option>';
    kelasList.forEach(k => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = k;
        selectKelas.appendChild(opt);
    });
    if (kelasList.includes(prevKelas)) selectKelas.value = prevKelas;
    else selectKelas.value = '';

    selectMapel.innerHTML = '<option value="">Semua Mapel</option>';
    mapelList.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        selectMapel.appendChild(opt);
    });
    if (mapelList.includes(prevMapel)) selectMapel.value = prevMapel;
    else selectMapel.value = '';

    if (typeof syncCustomSelect === 'function') {
        syncCustomSelect('filter-kelas-monitoring');
        syncCustomSelect('filter-mapel-monitoring');
    }
}

async function loadMonitoring() {
    const tbody = document.getElementById('tabel-monitoring');
    const filterKelas = document.getElementById('filter-kelas-monitoring').value;
    const filterMapel = document.getElementById('filter-mapel-monitoring').value;
    const filterTglAwal = document.getElementById('filter-tgl-awal-monitoring').value;
    const filterTglAkhir = document.getElementById('filter-tgl-akhir-monitoring').value;
    const searchName = document.getElementById('search-nama-monitoring').value.toLowerCase();
    const banner = document.getElementById('mon-status-banner');

    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:16px;"><i class="fas fa-spinner fa-spin"></i> Memuat...</td></tr>';

    const { data: jadwalAktif } = await db.from('jadwal_ujian').select('id').eq('is_aktif', true);
    const adaUjianAktif = jadwalAktif && jadwalAktif.length > 0;

    // helper: apply base filters (kelas, mapel, search, tanggal) — tanpa status
    const applyBaseFilters = (q) => {
        if (filterKelas) q = q.eq('kelas', filterKelas);
        if (filterMapel) q = q.eq('mapel', filterMapel);
        if (searchName) q = q.ilike('nama', '%' + searchName + '%');
        if (filterTglAwal) q = q.gte('created_at', filterTglAwal + 'T00:00:00');
        if (filterTglAkhir) q = q.lte('created_at', filterTglAkhir + 'T23:59:59');
        return q;
    };

    // 1) Hitung kartu ringkasan — SELALU pakai base filter saja (tanpa status), agar klik card tidak bikin 0 semua
    let cntAktif = 0, cntSelesai = 0, cntPelanggaran = 0;
    try {
        const [selesaiRes, aktifRes, plgRes] = await Promise.all([
            applyBaseFilters(db.from('jawaban_ujian').select('id', { count: 'exact', head: true })).like('status', 'SELESAI%'),
            applyBaseFilters(db.from('jawaban_ujian').select('id', { count: 'exact', head: true })).not('status', 'like', 'SELESAI%'),
            applyBaseFilters(db.from('jawaban_ujian').select('id', { count: 'exact', head: true })).gt('pelanggaran', 0)
        ]);
        cntSelesai = selesaiRes.count || 0;
        cntAktif = aktifRes.count || 0;
        cntPelanggaran = plgRes.count || 0;
    } catch (_) {
        // fallback tetap hitung jika salah satu gagal
        try {
            const r = await applyBaseFilters(db.from('jawaban_ujian').select('id', { count: 'exact', head: true })).like('status', 'SELESAI%');
            cntSelesai = r.count || 0;
        } catch(e){ cntSelesai = 0; }
    }
    // update kartu segera (tidak tergantung hasil tabel filtered-by-status)
    const elAktif = document.getElementById('mon-aktif');
    const elSelesai = document.getElementById('mon-selesai');
    const elPlg = document.getElementById('mon-pelanggaran');
    if (elAktif) elAktif.innerText = String(cntAktif);
    if (elSelesai) elSelesai.innerText = String(cntSelesai);
    if (elPlg) elPlg.innerText = String(cntPelanggaran);

    // 2) Query tabel — base + status filter (untuk pagination & rows)
    let query = applyBaseFilters(db.from('jawaban_ujian').select('*', { count: 'exact' }).order('created_at', { ascending: false }));
    if (currentMonStatus === 'AKTIF') query = query.not('status', 'like', 'SELESAI%');
    else if (currentMonStatus === 'SELESAI') query = query.like('status', 'SELESAI%');
    else if (currentMonStatus === 'PELANGGARAN') query = query.gt('pelanggaran', 0);

    const { count: totalItemsCount } = await query;
    const totalItems = totalItemsCount || 0;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
    if (currentMonPage > totalPages) currentMonPage = totalPages;
    const startIdx = (currentMonPage - 1) * ITEMS_PER_PAGE;

    const { data, error } = await query.range(startIdx, startIdx + ITEMS_PER_PAGE - 1).limit(ITEMS_PER_PAGE);

    if (error || !data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">Belum ada data sesuai filter.</td></tr>';
        document.getElementById('mon-page-info').innerText = 'Menampilkan 0 dari 0';
        // JANGAN reset kartu ke 0 — sudah diisi di atas dari base filter
        if (!adaUjianAktif && totalItems === 0 && cntAktif === 0 && cntSelesai === 0) {
            banner.style.display = 'flex'; banner.innerHTML = '<i class="fas fa-info-circle"></i>&nbsp; Tidak ada ujian yang aktif saat ini.';
        } else {
            banner.style.display = 'none';
        }
        // tetap pagination info
        if (typeof updatePaginationMonitoring === 'function') updatePaginationMonitoring(totalItems);
        return;
    }

    tempMonitoringData = data;
    const sortedData = typeof sortMonitoringData === 'function' ? sortMonitoringData(data) : data;
    const _monSesi = getGuruSession();
    const _monIsAdmin = _monSesi && _monSesi.isAdmin === true;

    document.getElementById('mon-page-info').innerText = `Menampilkan ${startIdx + 1}-${Math.min(startIdx + ITEMS_PER_PAGE, totalItems)} dari ${totalItems} siswa`;
    tbody.innerHTML = '';

    if (sortedData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">Data tidak ditemukan sesuai filter/pencarian.</td></tr>';
    }

    const highlight = (text, q) => q ? text.replace(new RegExp(q, 'gi'), match => `<mark style="background-color: yellow; padding: 0;">${match}</mark>`) : text;

    sortedData.forEach((s, i) => {
        const isSelesai = String(s.status).startsWith('SELESAI');
        const isPlg = parseInt(s.pelanggaran) > 0;

        let statusBadge = "";
        if (String(s.status).startsWith('PELANGGARAN')) {
            statusBadge = `<span class="badge" style="background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3);white-space:nowrap;display:inline-block;font-size:11px;letter-spacing:0.3px;animation:pulse 1.5s infinite;">🚨 ${s.status}</span>`;
        } else if (isSelesai) {
            statusBadge = `<span class="badge" style="background:rgba(16,185,129,0.1);color:#34d399;border:1px solid rgba(16,185,129,0.2);white-space:nowrap;display:inline-block;font-size:11px;letter-spacing:0.3px;">✅ ${s.status}</span>`;
        } else {
            statusBadge = `<span class="badge" style="background:rgba(234,179,8,0.15);color:#facc15;border:1px solid rgba(234,179,8,0.3);white-space:nowrap;display:inline-block;font-size:11px;letter-spacing:0.3px;">🟡 ${s.status || 'Mengerjakan...'}</span>`;
        }

        const plgBadge = isPlg
            ? `<button onclick="lihatPelanggaran(${s.id}, '${s.nama.replace(/'/g, "\\'")}')" title="Lihat Detail Pelanggaran" style="background:none;border:none;cursor:pointer;padding:2px 6px;border-radius:6px;transition:background 0.2s;color:#ef4444;font-weight:700;text-decoration:underline;text-underline-offset:2px;" onmouseover="this.style.background='rgba(239,68,68,0.12)'" onmouseout="this.style.background='none'"><i class="fas fa-exclamation-triangle"></i> ${s.pelanggaran}x</button>`
            : `<span style="color:#10b981;">✓ Bersih</span>`;

        const waktu = s.created_at ? new Date(s.created_at).toLocaleTimeString('id-ID') : '-';
        const displayNama = highlight(s.nama, searchName);

        const hapusBtn = _monIsAdmin
            ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:11px;color:#ef4444;border-color:rgba(239,68,68,0.3);" onclick="hapusDataNilai(${s.id}, '${s.nama}')" title="Hapus Data Siswa">
                    <i class="fas fa-trash"></i> Hapus
               </button>`
            : '';

        tbody.innerHTML += `
            <tr style="${!isSelesai ? 'background:rgba(250,204,21,0.06);' : ''}">
                <td data-label="" style="text-align:center;"><input type="checkbox" class="cb-monitoring" value="${s.id}"></td>
                <td data-label="No" style="text-align:center;">${startIdx + i + 1}</td>
                <td data-label="Nama Siswa" style="font-weight:600;">
                    <span class="mon-no-mobile" style="display:none; width:26px; height:26px; background:rgba(59,130,246,.14); border:1px solid rgba(59,130,246,.28); border-radius:7px; align-items:center; justify-content:center; font-size:12px; font-weight:800; color:#93c5fd; flex-shrink:0;">${startIdx + i + 1}</span>
                    <span class="mon-nama-text">${displayNama}</span>
                </td>
                <td data-label="Kelas / Mapel" style="text-align:center;">
                    <span class="badge" style="display:inline-block;margin-bottom:3px;">${s.kelas.includes('::') ? s.kelas.split('::')[1] : s.kelas}</span><br>
                    <span style="font-size:12px;color:var(--text-muted);font-weight:600;">${s.mapel}</span>
                </td>
                <td data-label="Status" style="text-align:center;">${statusBadge}</td>
                <td data-label="Pelanggaran" style="text-align:center;">${plgBadge}</td>
                <td data-label="Waktu Mulai" style="text-align:center; font-size:12px; color:var(--text-muted);">${waktu}</td>
                <td data-label="Aksi" style="text-align:center;">${hapusBtn}</td>
            </tr>`;
    });

    document.getElementById('mon-aktif').innerText = cntAktif;
    document.getElementById('mon-selesai').innerText = cntSelesai;
    document.getElementById('mon-pelanggaran').innerText = cntPelanggaran;

    if (cntAktif === 0 && !adaUjianAktif) {
        banner.style.display = 'flex';
        banner.innerHTML = '<i class="fas fa-check-circle"></i>&nbsp; Semua siswa sudah selesai & tidak ada ujian yang sedang berlangsung.';
    } else {
        banner.style.display = 'none';
    }
}

// --- SORTING ---
function toggleSortMonitoring(column) {
    const current = sortState.monitoring;
    if (current.column === column) current.direction = current.direction === 'asc' ? 'desc' : 'asc';
    else { current.column = column; current.direction = 'asc'; }
    currentMonPage = 1;
    loadMonitoring();
}

function updateSortIndicators(table) {
    const state = sortState[table];
    const prefix = table === 'monitoring' ? 'mon' : 'lap';
    const allIndicators = document.querySelectorAll(`[id^="sort-indicator-${prefix}"]`);
    allIndicators.forEach(el => el.textContent = '');
    if (state.column) {
        const activeIndicator = document.getElementById(`sort-indicator-${prefix}-${state.column}`);
        if (activeIndicator) {
            activeIndicator.textContent = state.direction === 'asc' ? '↑' : '↓';
            activeIndicator.style.color = state.direction === 'asc' ? '#34d399' : '#f87171';
        }
    }
}

function sortMonitoringData(data) {
    const col = sortState.monitoring.column;
    const dir = sortState.monitoring.direction;
    if (!col) return data;

    const sorted = [...data].sort((a, b) => {
        let valA, valB;
        switch (col) {
            case 'nama':
                valA = (a.nama || '').toLowerCase();
                valB = (b.nama || '').toLowerCase();
                break;
            case 'kelas':
                valA = (a.kelas || '').toLowerCase();
                valB = (b.kelas || '').toLowerCase();
                break;
            case 'status':
                const statusA = String(a.status || '').toUpperCase();
                const statusB = String(b.status || '').toUpperCase();
                const isASelesai = statusA.startsWith('SELESAI');
                const isBSelesai = statusB.startsWith('SELESAI');
                const isAPlg = statusA.startsWith('PELANGGARAN');
                const isBPlg = statusB.startsWith('PELANGGARAN');
                if (isAPlg && !isBPlg) return -1;
                if (!isAPlg && isBPlg) return 1;
                if (isAPlg && isBPlg) { const tA = new Date(a.created_at || '').getTime(); const tB = new Date(b.created_at || '').getTime(); return dir === 'asc' ? tA - tB : tB - tA; }
                if (isASelesai && !isBSelesai) return 1;
                if (!isASelesai && isBSelesai) return -1;
                if (isASelesai && isBSelesai) return dir === 'asc' ? statusA.localeCompare(statusB) : statusB.localeCompare(statusA);
                const tA = new Date(a.created_at || '').getTime();
                const tB = new Date(b.created_at || '').getTime();
                return dir === 'asc' ? tA - tB : tB - tA;
            case 'pelanggaran':
                valA = parseInt(a.pelanggaran) || 0;
                valB = parseInt(b.pelanggaran) || 0;
                break;
            case 'waktu':
                valA = new Date(a.created_at || '').getTime();
                valB = new Date(b.created_at || '').getTime();
                break;
            default: return 0;
        }
        if (col !== 'status') {
            let result = 0;
            if (typeof valA === 'string') result = valA.localeCompare(valB);
            else result = valA > valB ? 1 : valA < valB ? -1 : 0;
            return dir === 'asc' ? result : -result;
        }
    });
    updateSortIndicators('monitoring');
    return sorted;
}

// --- DATE FILTERS ---
function toggleDatePicker() {
    const dd = document.getElementById('date-picker-dropdown');
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

function onDateChange() {
    const tglAwal = document.getElementById('filter-tgl-awal-monitoring').value;
    const tglAkhir = document.getElementById('filter-tgl-akhir-monitoring').value;
    const label = document.getElementById('date-filter-label');
    if (tglAwal && tglAkhir) { const d1 = tglAwal.split('-').reverse().join('/'); const d2 = tglAkhir.split('-').reverse().join('/'); label.textContent = d1 + ' — ' + d2; }
    else if (tglAwal) { const d1 = tglAwal.split('-').reverse().join('/'); label.textContent = 'Dari ' + d1; }
    else if (tglAkhir) { const d2 = tglAkhir.split('-').reverse().join('/'); label.textContent = 'Sampai ' + d2; }
    else label.textContent = 'Semua Tanggal';
    currentMonPage = 1;
    loadMonitoring();
}

function applyDateFilter() { onDateChange(); document.getElementById('date-picker-dropdown').style.display = 'none'; }

function clearDateFilter() {
    document.getElementById('filter-tgl-awal-monitoring').value = '';
    document.getElementById('filter-tgl-akhir-monitoring').value = '';
    document.getElementById('date-filter-label').textContent = 'Semua Tanggal';
    currentMonPage = 1;
    loadMonitoring();
    document.getElementById('date-picker-dropdown').style.display = 'none';
}

// --- CLEAR FILTERS ---
function clearFilterMonitoring() {
    document.getElementById('search-nama-monitoring').value = '';
    document.getElementById('filter-mapel-monitoring').value = '';
    document.getElementById('filter-kelas-monitoring').value = '';
    document.getElementById('filter-tgl-awal-monitoring').value = '';
    document.getElementById('filter-tgl-akhir-monitoring').value = '';
    document.getElementById('date-filter-label').textContent = 'Semua Tanggal';
    if (typeof syncCustomSelect === 'function') {
        syncCustomSelect('filter-mapel-monitoring');
        syncCustomSelect('filter-kelas-monitoring');
    }
    currentMonStatus = 'ALL';
    const cards = { 'AKTIF': document.getElementById('mon-card-aktif'), 'SELESAI': document.getElementById('mon-card-selesai'), 'PELANGGARAN': document.getElementById('mon-card-pelanggaran') };
    Object.entries(cards).forEach(([status, card]) => {
        if (card) { card.style.borderWidth = '2px'; card.style.background = status === 'AKTIF' ? 'rgba(16,185,129,0.04)' : status === 'SELESAI' ? 'rgba(59,130,246,0.04)' : 'rgba(239,68,68,0.04)'; }
    });
    currentMonPage = 1;
    loadMonitoring();
}

function clearSortMonitoring() {
    sortState.monitoring.column = null;
    sortState.monitoring.direction = 'asc';
    updateSortIndicators('monitoring');
    currentMonPage = 1;
    loadMonitoring();
}

function resetMonitoringFilter() { return clearFilterMonitoring(); }

// --- BULK ACTIONS ---
async function bulkActionMonitoring(action) {
    const s = getGuruSession();
    if (!s || s.isAdmin !== true) { showToast('Akses ditolak. Hanya Admin.', 'error'); return; }
    const ids = Array.from(document.querySelectorAll('.cb-monitoring:checked')).map(cb => cb.value);
    if (ids.length === 0) return showToast("Pilih minimal satu siswa!", 'info');
    if (action === 'delete') {
        const confirmed = await asyncConfirm(`Hapus data sesi <b>${ids.length} siswa</b> terpilih?<br>Tindakan ini tidak bisa dibatalkan.`, "Hapus Data Siswa?");
        if (!confirmed) { showToast("Hapus data dibatalkan", 'info'); return; }
        const { data: backupData } = await db.from('jawaban_ujian').select('*').in('id', ids);
        const { error: batchErr } = await adminDb.batchDelete('jawaban_ujian', ids);
        if (batchErr) { showToast("Gagal menghapus: " + batchErr.message, 'error'); return; }
        const undoFunc = async () => {
            if (backupData && backupData.length > 0) { await chunkedInsert('jawaban_ujian', backupData); loadMonitoring(); showToast(`${ids.length} data siswa berhasil di-restore`, 'success'); }
        };
        showToast(`${ids.length} data siswa berhasil dihapus`, 'success', undoFunc, 'Undo');
        loadMonitoring();
    }
}

async function hapusDataNilai(id, nama) {
    const s = getGuruSession();
    if (!s || s.isAdmin !== true) { showToast('Akses ditolak. Hanya Admin.', 'error'); return; }
    if (!await asyncConfirm(`Hapus data sesi/jawaban siswa "${nama}"?<br>Anda akan memiliki waktu untuk membatalkan tindakan ini.`, "Hapus Data Siswa?")) return;
    const { data: savedData } = await db.from('jawaban_ujian').select('*').eq('id', id).single();
    const { error } = await adminDb.delete('jawaban_ujian', id);
    if (error) showToast("Gagal menghapus: " + error.message, 'error');
    else {
        const undoDelete = async () => {
            if (savedData) {
                const { error: insertError } = await adminDb.insert('jawaban_ujian', [savedData]);
                if (insertError) showToast("Gagal membatalkan penghapusan: " + insertError.message, 'error');
                else { showToast(`Data siswa "${nama}" berhasil dipulihkan`, 'success'); if (document.getElementById('monitoring').classList.contains('active')) loadMonitoring(); else if (typeof loadNilaiSiswa === 'function') loadNilaiSiswa(); }
            }
        };
        showToast(`Data siswa "${nama}" berhasil dihapus`, 'success', undoDelete, 'Batalkan');
        if (document.getElementById('monitoring').classList.contains('active')) loadMonitoring();
        else if (typeof loadNilaiSiswa === 'function') loadNilaiSiswa();
    }
}

// ===== DATE PICKER LAPORAN =====
function toggleDatePickerLaporan() {
    const dd = document.getElementById('date-picker-dropdown-laporan');
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

function onDateChangeLaporan() {
    const tglAwal = document.getElementById('filter-tgl-awal-laporan').value;
    const tglAkhir = document.getElementById('filter-tgl-akhir-laporan').value;
    const label = document.getElementById('date-filter-label-laporan');
    if (tglAwal && tglAkhir) { const d1 = tglAwal.split('-').reverse().join('/'); const d2 = tglAkhir.split('-').reverse().join('/'); label.textContent = d1 + ' — ' + d2; }
    else if (tglAwal) { const d1 = tglAwal.split('-').reverse().join('/'); label.textContent = 'Dari ' + d1; }
    else if (tglAkhir) { const d2 = tglAkhir.split('-').reverse().join('/'); label.textContent = 'Sampai ' + d2; }
    else label.textContent = 'Semua Tanggal';
    currentLapPage = 1;
    if (typeof loadNilaiSiswa === 'function') loadNilaiSiswa();
}

function applyDateFilterLaporan() { onDateChangeLaporan(); document.getElementById('date-picker-dropdown-laporan').style.display = 'none'; }

function clearDateFilterLaporan() {
    document.getElementById('filter-tgl-awal-laporan').value = '';
    document.getElementById('filter-tgl-akhir-laporan').value = '';
    document.getElementById('date-filter-label-laporan').textContent = 'Semua Tanggal';
    currentLapPage = 1;
    if (typeof loadNilaiSiswa === 'function') loadNilaiSiswa();
    document.getElementById('date-picker-dropdown-laporan').style.display = 'none';
}

// ===== OFFLINE UPLOAD HANDLER =====
async function handleUploadDarurat(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    let successCount = 0, failCount = 0, failDetails = [];

    Swal.fire({ title: 'Mengoreksi Jawaban...', html: 'Sistem sedang membaca file dan memasukkan nilai ke database...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
            let text = await file.text();
            text = text.replace(/\\n/g, '\n');

            const namaMatch = text.match(/Nama:\s*(.+)/);
            const kelasMatch = text.match(/Kelas:\s*(.+)/);
            const mapelMatch = text.match(/Mapel:\s*(.+)/);
            if (!namaMatch || !kelasMatch || !mapelMatch) throw new Error("Format header tidak sesuai.");
            const n = namaMatch[1].trim(), k = kelasMatch[1].trim(), m = mapelMatch[1].trim();

            const jsonSplit = text.split('=== JANGAN UBAH TEKS DI BAWAH INI ===');
            if (jsonSplit.length < 2) throw new Error("Payload JSON tidak ditemukan.");
            const payloadJawaban = JSON.parse(jsonSplit[1].trim());

            let { data: cekSesi } = await db.from('jawaban_ujian').select('id').eq('nama', n).eq('kelas', k).eq('mapel', m).maybeSingle();
            let idRow = null;
            if (cekSesi) idRow = cekSesi.id;
            else {
                const { data: inserted, error: errIns } = await adminDb.insert('jawaban_ujian', [{ nama: n, kelas: k, mapel: m, status: 'AKTIF (OFFLINE)', skor_pg: null, jawaban_essay: '', pelanggaran: 0, durasi: '-', created_at: new Date().toISOString() }]);
                if (errIns) throw errIns;
                if (inserted && inserted.length > 0) idRow = inserted[0].id;
            }

            const { error } = await adminDb.rpc('koreksi_dan_submit', {
                p_id_row: idRow, p_nama: n, p_kelas: k, p_mapel: m,
                p_jawaban: payloadJawaban, p_pelanggaran: 0, p_durasi: 'Upload Manual',
                p_status: "SELESAI - " + new Date().toLocaleTimeString('id-ID')
            });
            if (error) throw new Error(`RPC koreksi_dan_submit gagal: ${error.message || JSON.stringify(error)}`);
            successCount++;
        } catch (err) {
            failDetails.push({ file: file.name, error: err.message || JSON.stringify(err) });
            failCount++;
        }
    }

    event.target.value = '';

    let htmlResult = `Berhasil diproses: <b>${successCount}</b> file<br>Gagal diproses: <b>${failCount}</b> file`;
    if (failDetails.length > 0) {
        htmlResult += '<hr style="margin:10px 0;">';
        failDetails.forEach(fd => { htmlResult += `<div style="text-align:left;font-size:12px;margin:5px 0;padding:5px;background:rgba(239,68,68,0.1);border-radius:4px;"><strong>${fd.file}</strong><br>${fd.error}</div>`; });
    }

    Swal.fire({ title: 'Upload Selesai!', html: htmlResult, icon: successCount > 0 ? 'success' : 'warning', confirmButtonColor: '#3b82f6' });
    if (successCount > 0 && typeof loadNilaiSiswa === 'function') loadNilaiSiswa();
}
