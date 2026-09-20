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
const seenIdsGlobal = new Set();
let monitoringChannel = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let intentionalClose = false;
let isSubscribing = false;
let isLoadingMonitoring = false;
const violationCooldownMs = 60000;
const violationLastToastAt = new Map();
let _monMapelCache = [];
function scheduleReconnect(){
  if(intentionalClose) return;
  if(reconnectTimer) clearTimeout(reconnectTimer);
  const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts++));
  console.warn(`[monitoring] reconnect ${reconnectAttempts} in ${delay}ms`);
  reconnectTimer = setTimeout(()=> startRealtimeMonitoring(), delay);
}
async function startRealtimeMonitoring() {
    if(isSubscribing) return;
    // guard: jika sudah joined/joining jangan buat channel baru
    if(monitoringChannel && ['joined','joining','subscribed'].includes(monitoringChannel.state)){
        return;
    }
    if(reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer=null; }
    if (monitoringChannel) {
        intentionalClose = true;
        try{ await db.removeChannel(monitoringChannel);}catch(e){}
        monitoringChannel = null;
        // beri jeda singkat agar server benar-benar close
        await new Promise(r=>setTimeout(r,80));
        intentionalClose = false;
    }
    // bersihkan stale channel dengan nama sama (jika leak sebelumnya)
    try{
        const stale = db.getChannels().filter(c=> c.topic === 'realtime:monitoring-live-v2');
        for(const ch of stale){ try{ await db.removeChannel(ch);}catch(e){} }
    }catch(e){}
    isSubscribing = true;
    intentionalClose = false;
    monitoringChannel = db.channel('monitoring-live-v2');

    monitoringChannel = monitoringChannel
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'jawaban_ujian' },
            payload => {
                const s = payload.new;
                const prev = payload.old || {};
                const ev = payload.eventType;

                const overlay = document.getElementById('landingOverlay');
                if (overlay && typeof updateLandingSiswaAktif === 'function') updateLandingSiswaAktif();

                if (ev === 'INSERT' && s.id && seenIdsGlobal.has(s.id)) {
                    if ((s.status || '').startsWith('SELESAI')) { seenIdsGlobal.delete(s.id); violationTracker.delete(s.id); violationLastToastAt.delete(s.id); }
                    return;
                }
                if (ev === 'INSERT' && s.id && !((s.status || '').startsWith('SELESAI'))) seenIdsGlobal.add(s.id);

                if (ev === 'UPDATE') {
                    const currentPlg = parseInt(s.pelanggaran) || 0;
                    const prevPlg = violationTracker.get(s.id);
                    const hasPrev = violationTracker.has(s.id);
                    const isIncrement = hasPrev ? (currentPlg > prevPlg) : (currentPlg > 0 && (parseInt(prev.pelanggaran)||0) < currentPlg);
                    if (isIncrement) {
                        const lastToast = violationLastToastAt.get(s.id) || 0;
                        const nowTs = Date.now();
                        if (nowTs - lastToast > violationCooldownMs) {
                            if (!document.hidden) showToast(`Pelanggaran! ${s.nama} (${s.kelas}) — ${currentPlg}x`, 'plg');
                            violationLastToastAt.set(s.id, nowTs);
                        }
                    }
                    if (hasPrev || currentPlg>0) violationTracker.set(s.id, currentPlg);
                    else if (!hasPrev && currentPlg===0) violationTracker.set(s.id, 0);
                    if ((s.status || '').startsWith('SELESAI')) {
                        if (!document.hidden && !seenIdsGlobal.has('selesai-'+s.id)) {
                            showToast(`${s.nama} (${s.kelas}) — Selesai!`, 'selesai');
                            seenIdsGlobal.add('selesai-'+s.id);
                            setTimeout(()=> seenIdsGlobal.delete('selesai-'+s.id), 30000);
                        }
                        if (typeof loadRecentActivity === 'function') loadRecentActivity();
                        seenIdsGlobal.delete(s.id); violationTracker.delete(s.id); violationLastToastAt.delete(s.id);
                    }
                }
                if (ev === 'INSERT') {
                    if ((s.status || '').startsWith('SELESAI')) {
                        if (typeof loadRecentActivity === 'function') loadRecentActivity();
                        seenIdsGlobal.delete(s.id); violationTracker.delete(s.id); violationLastToastAt.delete(s.id);
                    } else {
                        if(!violationTracker.has(s.id)) violationTracker.set(s.id, parseInt(s.pelanggaran)||0);
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
                isSubscribing = false;
                reconnectAttempts = 0;
                intentionalClose = false;
                console.log('✅ Realtime monitoring terhubung!');
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                isSubscribing = false;
                if(intentionalClose){
                    console.log('Realtime monitoring closed intentionally — skip reconnect');
                    return;
                }
                console.error('❌ Realtime monitoring gagal:', status, err || '(no err) — cek publication & RLS');
                if(status==='CLOSED' && !err) console.warn('Hint: publication supabase_realtime belum ada — sudah difix via migration 20260911000000');
                scheduleReconnect();
            } else {
                isSubscribing = false;
                console.warn('Realtime status:', status, err);
            }
        });
}

async function stopMonitoring() {
    intentionalClose = true;
    isSubscribing = false;
    if(reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer=null; }
    if(window._monDebounce){ clearTimeout(window._monDebounce); window._monDebounce=null; }
    if (monitoringChannel) { try{ await db.removeChannel(monitoringChannel);}catch(e){} monitoringChannel = null; }
    reconnectAttempts = 0;
    // reset intentionalClose setelah channel benar-benar tertutup
    setTimeout(()=> intentionalClose=false, 600);
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
    // — COMPREHENSIVE: tambah riwayat agar mapel pernah diujikan tetap muncul
    try{
        const fetchMapels = async (table)=>{
            let out=[]; let from=0; const PAGE=1000;
            while(true){
                const { data, error } = await db.from(table).select('mapel').range(from, from+PAGE-1);
                if(error || !data || data.length===0) break;
                out = out.concat(data);
                if(data.length<PAGE) break;
                from+=PAGE; if(from>10000) break;
            }
            return out;
        };
        const [jwbRows, jadRows] = await Promise.all([fetchMapels('jawaban_ujian'), fetchMapels('jadwal_ujian')]);
        const compSet = new Set(mapelList);
        (jwbRows||[]).forEach(r=>{ if(r.mapel) compSet.add(r.mapel.trim()); });
        (jadRows||[]).forEach(r=>{ if(r.mapel) compSet.add(r.mapel.trim()); });
        mapelList = [...compSet].sort((a,b)=>a.localeCompare(b,'id'));
    }catch(_){}

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

    // searchable mapel — compact
    _monMapelCache = [...mapelList];
    try{
        const inpMon=document.getElementById('filter-mapel-monitoring-search');
        const selMon=document.getElementById('filter-mapel-monitoring');
        const ddMon=document.getElementById('filter-mapel-monitoring-dropdown');
        if(selMon && inpMon){
            if(selMon.value) inpMon.value=selMon.value;
            else if(!inpMon.dataset.userTyped) inpMon.value='';
        }
        // hapus csl lama untuk mapel monitoring
        document.querySelectorAll('.csl-container').forEach(c=>{
            if(c.contains(selectMapel)){
                const b=c.querySelector('.csl-btn'); if(b) b.remove();
                const d=c.querySelector('.csl-dropdown'); if(d && d.id!=='filter-mapel-monitoring-dropdown') d.remove();
                if(c.children.length===1 && c.contains(selectMapel)){
                    const par=c.parentNode; if(par){ par.insertBefore(selectMapel, c); c.remove(); }
                } else c.style.display='none';
                delete selectMapel.dataset.cslReady;
            }
        });
        if(selectMapel){ selectMapel.style.display='none'; selectMapel.classList.remove('csl-native'); delete selectMapel.dataset.cslReady; }
        document.querySelectorAll('#filter-mapel-monitoring-csldd').forEach(el=> el.remove());
        if(inpMon && ddMon){
            if(!inpMon.dataset.monSearchReady){
                inpMon.dataset.monSearchReady='1';
                inpMon.addEventListener('input', ()=>{ inpMon.dataset.userTyped='1'; renderMonMapelDropdown(inpMon.value); ddMon.style.display='block'; });
                inpMon.addEventListener('focus', ()=>{
                    const v=(inpMon.value||'').trim();
                    if(v) renderMonMapelDropdown(v);
                    else { ddMon.innerHTML='<div style="padding:8px; text-align:center; color:#64748b; font-size:11px;">Cari Mapel</div>'; ddMon.style.display='block'; }
                });
                inpMon.addEventListener('blur', ()=> setTimeout(()=>{
                    ddMon.style.display='none';
                    // jangan auto-refresh saat blur/klik kosong — hanya hide, revert input ke nilai terpilih
                    const sel=document.getElementById('filter-mapel-monitoring');
                    if(sel && inpMon){
                        const cur=sel.value||'';
                        if((inpMon.value||'').trim() !== cur) inpMon.value = cur;
                    }
                }, 180));
                inpMon.addEventListener('keydown', (e)=>{
                    if(e.key==='Enter'){
                        e.preventDefault();
                        const typed=(inpMon.value||'').trim().toLowerCase();
                        const first=_monMapelCache.find(m=> m.toLowerCase().includes(typed));
                        if(first) selectMonMapel(first);
                    } else if(e.key==='Escape'){ ddMon.style.display='none'; inpMon.blur(); }
                });
                document.addEventListener('click', (e)=>{
                    if(!inpMon.contains(e.target) && !ddMon.contains(e.target)) ddMon.style.display='none';
                });
            }
            ddMon.style.display='none';
        }
    }catch(e){}

    if (typeof syncCustomSelect === 'function') {
        syncCustomSelect('filter-kelas-monitoring');
    }
}

function renderMonMapelDropdown(filter){
    const dd=document.getElementById('filter-mapel-monitoring-dropdown');
    if(!dd) return;
    const q=(filter||'').trim().toLowerCase();
    if(!q){
        dd.innerHTML='<div style="padding:8px; text-align:center; color:#64748b; font-size:11px;">Cari Mapel</div>';
        dd.style.display='block'; return;
    }
    const list=_monMapelCache.filter(m=> m.toLowerCase().includes(q));
    if(!list.length){
        dd.innerHTML='<div style="padding:8px; text-align:center; color:#64748b; font-size:11px;">Tidak ada mapel cocok</div>';
        dd.style.display='block'; return;
    }
    dd.innerHTML=list.map(m=> `<div class="csl-option" style="padding:6px 10px; font-size:11px; cursor:pointer; border-radius:6px;" onmousedown="event.preventDefault(); selectMonMapel('${m.replace(/'/g,"\\'")}')">${m}</div>`).join('');
    dd.style.display='block';
}
function selectMonMapel(val){
    const sel=document.getElementById('filter-mapel-monitoring');
    const inp=document.getElementById('filter-mapel-monitoring-search');
    const dd=document.getElementById('filter-mapel-monitoring-dropdown');
    if(sel){
        let exists=[...sel.options].some(o=>o.value===val);
        if(!exists){ const opt=document.createElement('option'); opt.value=val; opt.textContent=val; sel.appendChild(opt); }
        sel.value=val; sel.dispatchEvent(new Event('change',{bubbles:true}));
    }
    if(inp){ inp.value=val; inp.dataset.userTyped='1'; }
    if(dd) dd.style.display='none';
}

async function loadMonitoring() {
    if(isLoadingMonitoring) return;
    isLoadingMonitoring = true;
    try{
    const tbody = document.getElementById('tabel-monitoring');
    if(!tbody){ isLoadingMonitoring=false; return; }
    const filterKelas = document.getElementById('filter-kelas-monitoring')?.value || '';
    const filterMapel = document.getElementById('filter-mapel-monitoring')?.value || '';
    const filterTglAwal = document.getElementById('filter-tgl-awal-monitoring')?.value || '';
    const filterTglAkhir = document.getElementById('filter-tgl-akhir-monitoring')?.value || '';
    const searchName = (document.getElementById('search-nama-monitoring')?.value || '').toLowerCase();
    const banner = document.getElementById('mon-status-banner');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:16px;"><i class="fas fa-spinner fa-spin"></i> Memuat...</td></tr>';

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
        const pi=document.getElementById('mon-page-info'); if(pi) pi.innerText = 'Menampilkan 0 dari 0';
        if (!adaUjianAktif && totalItems === 0 && cntAktif === 0 && cntSelesai === 0) {
            banner.style.display = 'flex'; banner.innerHTML = '<i class="fas fa-info-circle"></i>&nbsp; Tidak ada ujian yang aktif saat ini.';
        } else {
            banner.style.display = 'none';
        }
        if (typeof updatePaginationMonitoring === 'function') try{ updatePaginationMonitoring(totalItems); }catch(e){}
        isLoadingMonitoring=false;
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

        const safeNamaPlg = (s.nama||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
        const plgBadge = isPlg
            ? `<button onclick="lihatPelanggaran(${s.id}, '${safeNamaPlg}')" title="Lihat Detail Pelanggaran" style="background:none;border:none;cursor:pointer;padding:2px 6px;border-radius:6px;transition:background 0.2s;color:#ef4444;font-weight:700;text-decoration:underline;text-underline-offset:2px;" onmouseover="this.style.background='rgba(239,68,68,0.12)'" onmouseout="this.style.background='none'"><i class="fas fa-exclamation-triangle"></i> ${s.pelanggaran}x</button>`
            : `<span style="color:#10b981;">✓ Bersih</span>`;

        const waktu = s.created_at ? new Date(s.created_at).toLocaleTimeString('id-ID') : '-';
        const displayNama = highlight(s.nama, searchName);

        const safeNama = (s.nama||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
        const hapusBtn = _monIsAdmin
            ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:11px;color:#ef4444;border-color:rgba(239,68,68,0.3);" onclick="hapusDataNilai(${s.id}, '${safeNama}')" title="Hapus Data Siswa">
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

    const _elAktif2=document.getElementById('mon-aktif'); if(_elAktif2) _elAktif2.innerText = String(cntAktif);
    const _elSelesai2=document.getElementById('mon-selesai'); if(_elSelesai2) _elSelesai2.innerText = String(cntSelesai);
    const _elPlg2=document.getElementById('mon-pelanggaran'); if(_elPlg2) _elPlg2.innerText = String(cntPelanggaran);
    if (cntAktif === 0 && !adaUjianAktif) {
        banner.style.display = 'flex';
        banner.innerHTML = '<i class="fas fa-check-circle"></i>&nbsp; Semua siswa sudah selesai & tidak ada ujian yang sedang berlangsung.';
    } else {
        banner.style.display = 'none';
    }
    try{
        data.forEach(s=>{
            const cur=parseInt(s.pelanggaran)||0;
            if(!violationTracker.has(s.id)) violationTracker.set(s.id, cur);
            else if(cur > violationTracker.get(s.id)) violationTracker.set(s.id, cur);
            if(String(s.status||'').startsWith('SELESAI')) seenIdsGlobal.delete(s.id); else seenIdsGlobal.add(s.id);
        });
    }catch(e){}
    }catch(e){ console.warn('[monitoring] load error',e); }finally{ isLoadingMonitoring=false; }
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
    const inpMon=document.getElementById('filter-mapel-monitoring-search');
    if(inpMon){ inpMon.value=''; inpMon.dataset.userTyped=''; }
    const ddMon=document.getElementById('filter-mapel-monitoring-dropdown');
    if(ddMon) ddMon.style.display='none';
    document.getElementById('filter-kelas-monitoring').value = '';
    document.getElementById('filter-tgl-awal-monitoring').value = '';
    document.getElementById('filter-tgl-akhir-monitoring').value = '';
    document.getElementById('date-filter-label').textContent = 'Semua Tanggal';
    if (typeof syncCustomSelect === 'function') {
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
    console.log('[bulkActionMonitoring] clicked', action);
    const s = getGuruSession();
    if (!s || s.isAdmin !== true) { console.log('bulkActionMonitoring: not admin', s); showToast('Akses ditolak. Hanya Admin.', 'error'); return; }
    const ids = Array.from(document.querySelectorAll('.cb-monitoring:checked')).map(cb => cb.value);
    if (ids.length === 0) return showToast("Pilih minimal satu siswa!", 'info');
    if (action === 'delete') {
        const confirmed = await asyncConfirm(`Hapus data sesi <b>${ids.length} siswa</b> terpilih?<br>Tindakan ini tidak bisa dibatalkan.`, "Hapus Data Siswa?");
        if (!confirmed) { showToast("Hapus data dibatalkan", 'info'); return; }
        const { data: backupData } = await db.from('jawaban_ujian').select('*').in('id', ids);
        const { error: batchErr } = await adminDb.batchDelete('jawaban_ujian', ids);
        if (batchErr) { showToast("Gagal menghapus: " + batchErr.message, 'error'); return; }
        try{ const ch=db.channel('admin-kick'); ch.subscribe(async (st)=>{ if(st==='SUBSCRIBED'){ await ch.send({type:'broadcast', event:'kick', payload:{ids}}); setTimeout(()=>{ try{ db.removeChannel(ch);}catch(e){} }, 1200); } }); }catch(e){}
        const undoFunc = async () => {
            if (backupData && backupData.length > 0) { await chunkedInsert('jawaban_ujian', backupData); loadMonitoring(); showToast(`${ids.length} data siswa berhasil di-restore`, 'success'); }
        };
        showToast(`${ids.length} data siswa berhasil dihapus`, 'success', undoFunc, 'Undo');
        loadMonitoring();
    }
}

async function hapusDataNilai(id, nama) {
    console.log('[hapusDataNilai] monitoring id', id, nama);
    const s = getGuruSession();
    if (!s || s.isAdmin !== true) { console.log('hapusDataNilai: not admin', s); showToast('Akses ditolak. Hanya Admin.', 'error'); return; }
    if (!await asyncConfirm(`Hapus data sesi/jawaban siswa "${nama}"?<br>Anda akan memiliki waktu untuk membatalkan tindakan ini.`, "Hapus Data Siswa?")) return;
    const { data: savedData } = await db.from('jawaban_ujian').select('*').eq('id', id).single();
    const { error } = await adminDb.delete('jawaban_ujian', id);
    if (error) showToast("Gagal menghapus: " + error.message, 'error');
    else {
        // broadcast kick biar browser siswa yang lagi di id itu langsung clear cache & reload (<1 detik, tanpa tunggu polling)
        try{ const ch=db.channel('admin-kick'); ch.subscribe(async (st)=>{ if(st==='SUBSCRIBED'){ await ch.send({type:'broadcast', event:'kick', payload:{ids:[id]}}); setTimeout(()=>{ try{ db.removeChannel(ch);}catch(e){} }, 1200); } }); }catch(e){}
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

    if(typeof showGlobalLoader==='function') showGlobalLoader('Mengoreksi jawaban...', {immediate:true});
    else { const _gl=document.getElementById('global-loader'); const _glT=document.getElementById('global-loader-text'); if(_glT) _glT.textContent='Mengoreksi jawaban...'; if(_gl){ _gl.style.display='flex'; _gl.classList.add('show'); } }

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
                const { data: inserted, error: errIns } = await adminDb.insert('jawaban_ujian', [{ nama: n, kelas: k, mapel: m, status: 'AKTIF (OFFLINE)', skor_pg: null, jawaban_essay: '', pelanggaran: 0, durasi: '-', created_at: new Date().toISOString() }], {silent:true});
                if (errIns) throw errIns;
                if (inserted && inserted.length > 0) idRow = inserted[0].id;
            }

            const { error } = await adminDb.rpc('koreksi_dan_submit', {
                p_id_row: idRow, p_nama: n, p_kelas: k, p_mapel: m,
                p_jawaban: payloadJawaban, p_pelanggaran: 0, p_durasi: 'Upload Manual',
                p_status: "SELESAI - " + new Date().toLocaleTimeString('id-ID')
            }, {silent:true});
            if (error) throw new Error(`RPC koreksi_dan_submit gagal: ${error.message || JSON.stringify(error)}`);
            successCount++;
        } catch (err) {
            failDetails.push({ file: file.name, error: err.message || JSON.stringify(err) });
            failCount++;
        }
    }

    event.target.value = '';

    if(typeof hideGlobalLoader==='function') hideGlobalLoader(); else { const _gl=document.getElementById('global-loader'); if(_gl){ _gl.classList.remove('show'); setTimeout(()=>{ if(!_gl.classList.contains('show')) _gl.style.display='none'; },220); } }

    let htmlResult = `Berhasil diproses: <b>${successCount}</b> file<br>Gagal diproses: <b>${failCount}</b> file`;
    if (failDetails.length > 0) {
        htmlResult += '<hr style="margin:10px 0;">';
        failDetails.forEach(fd => { htmlResult += `<div style="text-align:left;font-size:12px;margin:5px 0;padding:5px;background:rgba(239,68,68,0.1);border-radius:4px;"><strong>${fd.file}</strong><br>${fd.error}</div>`; });
    }

    Swal.fire({ title: 'Upload Selesai!', html: htmlResult, icon: successCount > 0 ? 'success' : 'warning', confirmButtonColor: '#3b82f6', background:'rgba(15,23,42,0.98)', color:'#f1f5f9' });
    if (successCount > 0 && typeof loadNilaiSiswa === 'function') loadNilaiSiswa();
}
