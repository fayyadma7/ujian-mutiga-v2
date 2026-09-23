// @ts-nocheck
// ============================================================
// admin-monitoring.js — Live Monitoring Section
// Functions: loadMonitoring, startRealtimeMonitoring, stopMonitoring,
//            resetMonitoringFilter, clearFilterMonitoring, clearSortMonitoring,
//            updateCounts, toggleSortMonitoring, sortMonitoringData,
//            updateSortIndicators, populateFilterKelas,
//            toggleDatePicker, onDateChange, applyDateFilter, clearDateFilter,
//            bulkActionMonitoring, hapusDataNilai
//            (handleUploadDarurat pindah ke admin-laporan.js — tombolnya di halaman Laporan)
// ============================================================

var violationTracker = typeof violationTracker !== 'undefined' ? violationTracker : new Map();
var seenIdsGlobal = typeof seenIdsGlobal !== 'undefined' ? seenIdsGlobal : new Set();
var monitoringChannel = typeof monitoringChannel !== 'undefined' ? monitoringChannel : null;
var reconnectTimer = typeof reconnectTimer !== 'undefined' ? reconnectTimer : null;
var reconnectAttempts = typeof reconnectAttempts !== 'undefined' ? reconnectAttempts : 0;
var intentionalClose = typeof intentionalClose !== 'undefined' ? intentionalClose : false;
var isSubscribing = typeof isSubscribing !== 'undefined' ? isSubscribing : false;
var isLoadingMonitoring = typeof isLoadingMonitoring !== 'undefined' ? isLoadingMonitoring : false;
var violationCooldownMs = typeof violationCooldownMs !== 'undefined' ? violationCooldownMs : 60000;
var violationLastToastAt = typeof violationLastToastAt !== 'undefined' ? violationLastToastAt : new Map();
var _monMapelCache = typeof _monMapelCache !== 'undefined' ? _monMapelCache : [];
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
                    window._monDebounce = setTimeout(() => { loadMonitoring({silent:true}); }, 1000);
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

var _prevMonDataMap = typeof _prevMonDataMap !== 'undefined' ? _prevMonDataMap : new Map();
function _setMonLoading(on, silent){
    if(silent) return;
    const ov=document.getElementById('monitoring-loading-overlay');
    const wrap=document.getElementById('monitoring-table-wrap');
    if(ov){ ov.classList.toggle('show', !!on); ov.setAttribute('aria-hidden', on?'false':'true'); }
    if(wrap){ wrap.classList.toggle('mon-loading', !!on); }
    document.querySelectorAll('#mon-card-aktif, #mon-card-selesai, #mon-card-pelanggaran, #mon-card-belum').forEach(c=>{ if(c) c.classList.toggle('mon-stats-loading', !!on); });
}
var _pendingMonReload = typeof _pendingMonReload !== 'undefined' ? _pendingMonReload : false;
var _pendingMonSilent = typeof _pendingMonSilent !== 'undefined' ? _pendingMonSilent : false;
var _monSearchDebounce = typeof _monSearchDebounce !== 'undefined' ? _monSearchDebounce : null;
function onMonSearchInput(){
    currentMonPage = 1;
    if(_monSearchDebounce) clearTimeout(_monSearchDebounce);
    _monSearchDebounce = setTimeout(()=> loadMonitoring(), 300);
}
async function loadMonitoring(opts) {
    const _isSilent = !!(opts && opts.silent);
    if(isLoadingMonitoring){
        _pendingMonReload = true;
        _pendingMonSilent = _pendingMonSilent || _isSilent;
        // jika yang pending adalah filter (non-silent), pastikan overlay tetap tampil
        if(!_isSilent) _pendingMonSilent = false;
        return;
    }
    isLoadingMonitoring = true;
    // WATCHDOG: kalau load macet >20 detik (jaringan gantung), paksa reset biar klik berikutnya tidak mati total
    const _monRunId = Date.now() + Math.random();
    window._monRunId = _monRunId;
    setTimeout(()=>{ if(window._monRunId === _monRunId && isLoadingMonitoring){ console.warn('[monitoring] watchdog: load macet, paksa reset'); isLoadingMonitoring = false; _pendingMonReload = false; _setMonLoading(false); if(typeof showToast === 'function') showToast('Monitoring lambat — coba Refresh lagi', 'info'); } }, 20000);
    // Untuk filter/sort/clear/search/pagination — tampilkan overlay animasi konsisten seperti laporan/jadwal
    // Untuk realtime silent — jangan tampilkan overlay full, hanya row-level blur
    _setMonLoading(true, _isSilent);
    try{
    const tbody = document.getElementById('tabel-monitoring');
    if(!tbody){ _setMonLoading(false, _isSilent); isLoadingMonitoring=false; return; }
    const filterKelas = document.getElementById('filter-kelas-monitoring')?.value || '';
    const filterMapel = document.getElementById('filter-mapel-monitoring')?.value || '';
    const filterTglAwal = document.getElementById('filter-tgl-awal-monitoring')?.value || '';
    const filterTglAkhir = document.getElementById('filter-tgl-akhir-monitoring')?.value || '';
    const searchName = (document.getElementById('search-nama-monitoring')?.value || '').toLowerCase();
    const banner = document.getElementById('mon-status-banner');
    // jika langsung buka tanpa filter apapun, paksa ALL biar 1435 SELESAI langsung kelihatan (bukan AKTIF 0) — selalu reset ke ALL saat filter kosong
    if(!filterKelas && !filterMapel && !searchName && !filterTglAwal && !filterTglAkhir){
        if(currentMonStatus !== 'ALL'){
            currentMonStatus = 'ALL';
            try{ document.querySelectorAll('#mon-card-aktif, #mon-card-selesai, #mon-card-pelanggaran').forEach(c=>{ if(c) { c.style.borderWidth='2px'; c.style.background='rgba(255,255,255,0.02)'; } }); }catch(e){}
        }
    }
    // Pertahankan tinggi tabel saat loading — jangan kosongkan jika sudah ada rows, cukup blur via overlay (anti shrink/grow seperti jadwal)
    const _txtEarly = (tbody.textContent||'');
    const _isPlaceholderEarly = _txtEarly.includes('Memuat') || _txtEarly.includes('Belum ada');
    const _hasValidRows = tbody.children.length>0 && !_isPlaceholderEarly;
    if(!_hasValidRows && !_isPlaceholderEarly){
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px; color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Memuat...</td></tr>';
    }
    // jika sudah ada placeholder atau rows valid, biarkan tetap tampil di bawah overlay blur — tinggi stabil via min-height

    // ambil jadwal dengan waktu sekarang (biar tidak selalu Seni Budaya pertama) — is_aktif + now dalam window
    const { data: _allJadwal } = await db.from('jadwal_ujian').select('kelas,mapel,waktu_mulai,waktu_selesai,durasi_menit').eq('is_aktif', true);
    const nowMon = new Date();
    const jadwalAktifRows = (_allJadwal||[]).filter(j=>{
        try{
            const m = new Date(j.waktu_mulai);
            let s = j.waktu_selesai ? new Date(j.waktu_selesai) : new Date(m.getTime() + (j.durasi_menit||90)*60000);
            return nowMon >= m && nowMon <= s;
        }catch(e){ return false; }
    });
    const adaUjianAktif = jadwalAktifRows && jadwalAktifRows.length > 0;

    // auto dari jadwal aktif jika filter kosong — jangan ambil cuma first, biar tidak ngunci Seni Budaya; kosong = tampil semua jadwal aktif (campur)
    let autoKelas = filterKelas;
    let autoMapel = filterMapel;
    let hasJadwalForFilter = false;
    // Normalisasi untuk cek jadwal — handle format "id::Nama", comma, trim, case-insensitive
    const normKelas = (k) => (k||'').trim().toLowerCase();
    const kelasInJadwal = (jKelas, targetKelas) => {
        let k = (jKelas||'').trim();
        if(k.includes('::')) k = k.split('::')[1];
        return k.split(',').map(s=> normKelas(s)).includes(normKelas(targetKelas));
    };
    if(!filterKelas && !filterMapel && adaUjianAktif){
        // filter kosong + ada jadwal now → tampil semua jadwal aktif (p_kelas=null, p_mapel=null → RPC semua)
        hasJadwalForFilter = true;
        autoKelas = ''; autoMapel = '';
    } else if((filterKelas || filterMapel) && adaUjianAktif){
        // jika user sudah pilih filter, cek apakah ada jadwal untuk filter itu — biar BELUM tetap muncul walau filter cuma mapel
        hasJadwalForFilter = jadwalAktifRows.some(j=>{
            const jMapelOk = !filterMapel || normKelas(j.mapel) === normKelas(filterMapel);
            if(!jMapelOk) return false;
            if(!filterKelas) return true;
            return kelasInJadwal(j.kelas, filterKelas);
        });
        // jika filterMapel ada tapi filterKelas kosong, tetap anggap ada jadwal untuk mapel itu (case-insensitive)
        if(filterMapel && !filterKelas && jadwalAktifRows.some(j=> normKelas(j.mapel)===normKelas(filterMapel))) hasJadwalForFilter = true;
        // FIX: untuk klik dari dashboard, jadwal mungkin is_aktif true tapi waktu sudah lewat sedikit (now 1 menit lewat) — dashboard masih anggap aktif, monitoring sudah tidak
        // jadi kalau filterMapel+kelas ada tapi hasJadwalForFilter false karena window, tetap paksa campuran biar BELUM muncul (jangan kosong)
        if(!hasJadwalForFilter && (filterMapel || filterKelas)){
            // cek tanpa window time (hanya is_aktif + mapel+kelas) — untuk handle klik dashboard yang baru lewat waktu
            const hasJadwalTanpaWindow = (_allJadwal||[]).some(j=>{
                if(!j.is_aktif) return false;
                if(filterMapel && normKelas(j.mapel) !== normKelas(filterMapel)) return false;
                if(filterKelas && !kelasInJadwal(j.kelas, filterKelas)) return false;
                return true;
            });
            if(hasJadwalTanpaWindow){
                console.warn('[monitoring] hasJadwalForFilter false karena window, tapi jadwal tanpa window ada — paksa useCampuran untuk', filterMapel, filterKelas);
                hasJadwalForFilter = true;
            }
        }
    }

    // helper: apply base filters (kelas, mapel, search, tanggal) — tanpa status
    const applyBaseFilters = (q) => {
        if (filterKelas) q = q.eq('kelas', filterKelas);
        if (filterMapel) q = q.eq('mapel', filterMapel);
        if (searchName) q = q.ilike('nama', '%' + searchName + '%');
        if (filterTglAwal) q = q.gte('created_at', filterTglAwal + 'T00:00:00');
        if (filterTglAkhir) q = q.lte('created_at', filterTglAkhir + 'T23:59:59');
        return q;
    };

    // pakai RPC campuran hanya jika user sudah filter (kelas/mapel) dan ada jadwal untuk filter itu
    // JANGAN pakai untuk buka langsung tanpa filter (ALL) — biar histori 1435 tetap kelihatan, bukan 0 karena JOIN jadwal aktif
    let useCampuran = !!( (filterKelas || filterMapel) && hasJadwalForFilter );
    // fallback: kalau buka langsung tanpa filter (ALL) jangan paksa campuran, tampilkan histori penuh
    if(!filterKelas && !filterMapel && currentMonStatus === 'ALL'){
        useCampuran = false;
    }

    // 1) Hitung kartu ringkasan — 3 dari jawaban_ujian, BELUM awal 0 (akan diisi setelah RPC tabel biar tidak nge-hang)
    // CATATAN: kolom pelanggaran bertipe TEXT — JANGAN pakai .gt('pelanggaran', 0) karena perbandingan
    // teks membuat '10'/'22' lolos dari filter (bukan angka). Pakai neq '0' + neq '' (sinkron dgn parseInt di render).
    let cntAktif = 0, cntSelesai = 0, cntPelanggaran = 0, cntBelum = 0;
    try {
        const [selesaiRes, aktifRes, plgRes] = await Promise.all([
            applyBaseFilters(db.from('jawaban_ujian').select('id', { count: 'exact', head: true })).like('status', 'SELESAI%'),
            applyBaseFilters(db.from('jawaban_ujian').select('id', { count: 'exact', head: true })).not('status', 'like', 'SELESAI%'),
            applyBaseFilters(db.from('jawaban_ujian').select('id', { count: 'exact', head: true })).neq('pelanggaran', '0').neq('pelanggaran', '')
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
    const elBelum = document.getElementById('mon-belum');
    if (elAktif) elAktif.innerText = String(cntAktif);
    if (elSelesai) elSelesai.innerText = String(cntSelesai);
    if (elPlg) elPlg.innerText = String(cntPelanggaran);
    if (elBelum) elBelum.innerText = String(cntBelum);
    // sync ke dashboard & landing tanpa realtime channel (jika filter global)
    try{ if(typeof syncDashboardSedangFromMonitoring==='function') syncDashboardSedangFromMonitoring(cntAktif, filterKelas, filterMapel, searchName, filterTglAwal, filterTglAkhir); }catch(_){}
    try{ if(typeof syncLandingSiswaAktifFromMonitoring==='function') syncLandingSiswaAktifFromMonitoring(cntAktif, filterKelas, filterMapel, searchName, filterTglAwal, filterTglAkhir); }catch(_){}
    try{ const _isGlobal = !filterKelas && !filterMapel && !searchName && !filterTglAwal && !filterTglAkhir; if(_isGlobal){ const _de=document.getElementById('tot-sedang-ujian'); if(_de) _de.innerText = String(cntAktif); const _le=document.getElementById('landing-siswa-aktif'); if(_le) _le.innerText = String(cntAktif); } }catch(_){}
    // jika langsung buka Live tanpa filter dan tidak ada jadwal now, jangan paksa filter AKTIF/BELUM (0) — reset ke ALL biar 1434 SELESAI tetap kelihatan
    // juga jika ada 1 AKTIF tapi user tidak klik card, tetap tampil ALL biar tidak kosong
    if(!filterKelas && !filterMapel && (currentMonStatus === 'AKTIF' || currentMonStatus === 'BELUM')){
        // jika AKTIF/BELUM cuma 1 tapi total 1435, user pasti mau lihat semua, bukan cuma 1
        if(cntAktif <= 1 && (cntSelesai + cntAktif) > 10){
            currentMonStatus = 'ALL';
            try{ document.querySelectorAll('#mon-card-aktif, #mon-card-selesai, #mon-card-pelanggaran, #mon-card-belum').forEach(c=>{ if(c) c.style.borderWidth='2px'; c.style.background='rgba(255,255,255,0.02)'; }); }catch(e){}
        }
        // jika tidak ada jadwal now dan AKTIF/BELUM 0, juga reset
        if(!adaUjianAktif && cntAktif === 0 && cntBelum === 0 && cntSelesai > 0){
            currentMonStatus = 'ALL';
            try{ document.querySelectorAll('#mon-card-aktif, #mon-card-selesai, #mon-card-pelanggaran, #mon-card-belum').forEach(c=>{ if(c) c.style.borderWidth='2px'; c.style.background='rgba(255,255,255,0.02)'; }); }catch(e){}
        }
    }
    // KUNCI status untuk load ini — klik card lain di tengah load tidak boleh merusak hasil load ini
    // (klik baru otomatis antre reload sendiri via _pendingMonReload)
    const _st = currentMonStatus;

    // 2) Query tabel — jika ada jadwal aktif pakai RPC campuran Sudah+BELUM (menyesuaikan jadwal, campur beda status)
    let data = null, error = null, totalItems = 0, totalPages = 1, startIdx = 0;
    let _isCampuranMode = false;
    if(useCampuran){
        _isCampuranMode = true;
        try{
            const _s = getGuruSession(); const _gid = _s ? parseInt(_s.id) : null; const _isAdmin = _s ? !!_s.isAdmin : true;
            // FIX: untuk monitoring live, guru harus lihat semua BELUM di kelas itu (bukan hanya buatannya) — paksa true biar tidak 0
            // dan untuk p_only_active_now: kalau filter spesifik dari dashboard, longgarkan window (false) biar tidak kosong karena telat 1 menit
            const _monIsAdminForRpc = true; // selalu true untuk live monitoring — semua siswa di kelas itu terlihat
            const _onlyActiveNow = (!filterKelas && !filterMapel) ? true : false;
            const startIdxTmp = (currentMonPage - 1) * ITEMS_PER_PAGE;
            // hitung total via RPC count — kosong => null
            const { data: cntVal, error: cntErr } = await db.rpc('get_live_campuran_count', { p_kelas: autoKelas || null, p_mapel: autoMapel || null, p_search: searchName || null, p_guru_id: _gid, p_is_admin: _monIsAdminForRpc, p_only_active_now: _onlyActiveNow });
            totalItems = cntVal || 0;
            // Hitung BELUM di sini, dari total RPC SEBELUM filter status — biar klik card AKTIF/SELESAI/PELANGGARAN
            // tidak ikut meng-0-kan card BELUM (total RPC = sudah+belum untuk filter kelas/mapel ini)
            if(filterKelas || filterMapel){
                cntBelum = Math.max(0, totalItems - (cntAktif + cntSelesai));
                const elB2early = document.getElementById('mon-belum');
                if(elB2early) elB2early.innerText = String(cntBelum);
            }
            totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
            if(currentMonPage > totalPages) currentMonPage = totalPages;
            startIdx = (currentMonPage - 1) * ITEMS_PER_PAGE;
            const { data: rpcData, error: rpcErr } = await db.rpc('get_live_campuran', { p_kelas: autoKelas || null, p_mapel: autoMapel || null, p_search: searchName || null, p_limit: ITEMS_PER_PAGE, p_offset: startIdx, p_guru_id: _gid, p_is_admin: _monIsAdminForRpc, p_only_active_now: _onlyActiveNow });
            if(rpcErr) throw rpcErr;
            // filter status di JS — pakai _st (snapshot) biar konsisten satu load
            // AKTIF = sedang mengerjakan (bukan SELESAI dan bukan BELUM), SELESAI = SELESAI%, PELANGGARAN = pelanggaran>0, BELUM = is_belum
            let filtered = (rpcData||[]).map(r=>({ id:r.siswa_id, nama:r.nama, kelas:r.kelas_nama, mapel:r.mapel, status:r.status, pelanggaran:r.pelanggaran, skor_pg:r.skor_pg, created_at:r.created_at, is_belum:r.is_belum }));
            if(_st === 'AKTIF') filtered = filtered.filter(s=> !String(s.status).startsWith('SELESAI') && !s.is_belum);
            else if(_st === 'SELESAI') filtered = filtered.filter(s=> String(s.status).startsWith('SELESAI'));
            else if(_st === 'PELANGGARAN') filtered = filtered.filter(s=> parseInt(s.pelanggaran)>0);
            else if(_st === 'BELUM') filtered = filtered.filter(s=> s.is_belum);
            // Fallback ke histori HANYA saat RPC-nya sendiri kosong & status ALL.
            // Jangan fallback saat filter card (AKTIF/SELESAI/PELANGGARAN/BELUM) sengaja menghasilkan 0 —
            // itu hasil valid (mis. AKTIF=0 padahal BELUM=34), bukan error.
            const rpcEmpty = !(rpcData && rpcData.length);
            if(rpcEmpty && _st === 'ALL' && (cntAktif + cntSelesai) > 0){
                console.warn('[monitoring] RPC campuran kosong padahal histori ada ('+cntSelesai+' selesai), fallback ke histori');
                _isCampuranMode = false;
                // jangan return, biarkan fallback di bawah jalan
                data = null;
            } else {
                data = filtered;
                error = null;
            }
        }catch(e){ console.warn('[monitoring campuran] fallback',e); _isCampuranMode=false; }
    }
    // safety: jika campuran masih aktif tapi data null karena fallback di atas, paksa _isCampuranMode false
    if(_isCampuranMode && !data){
        _isCampuranMode = false;
    }
    if(!_isCampuranMode){
        // FIX: BELUM tidak ada di jawaban_ujian → kalau filter BELUM tapi tidak ada jadwal (tidak campuran), pasti kosong
        if(_st === 'BELUM'){
            data = []; totalItems = 0; error = null;
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px; color:var(--text-muted);">Belum ada siswa — tidak ada jadwal aktif untuk filter ini, atau semua sudah mengerjakan.</td></tr>';
            const pi=document.getElementById('mon-page-info'); if(pi) pi.innerText = 'Menampilkan 0 dari 0';
            banner.style.display = 'none';
            if (typeof updatePaginationMonitoring === 'function') try{ updatePaginationMonitoring(0); }catch(e){}
            _setMonLoading(false); isLoadingMonitoring=false;
            if(_pendingMonReload){ _pendingMonReload=false; setTimeout(()=>{ if(typeof loadMonitoring==='function') loadMonitoring(); }, 80); }
            return;
        }
        // FIX: single query dengan range+count (seperti admin-laporan.js) — hindari double-await reuse builder yang bikin kosong
        startIdx = (currentMonPage - 1) * ITEMS_PER_PAGE;
        let query = applyBaseFilters(db.from('jawaban_ujian').select('*', { count: 'exact' }).order('created_at', { ascending: false }));
        if (_st === 'AKTIF') query = query.not('status', 'like', 'SELESAI%');
        else if (_st === 'SELESAI') query = query.like('status', 'SELESAI%');
        else if (_st === 'PELANGGARAN') query = query.neq('pelanggaran', '0').neq('pelanggaran', '');
        const res = await query.range(startIdx, startIdx + ITEMS_PER_PAGE - 1);
        data = res.data; error = res.error; totalItems = res.count || 0;
        totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
        if (currentMonPage > totalPages) {
            currentMonPage = totalPages;
            startIdx = (currentMonPage - 1) * ITEMS_PER_PAGE;
            let q2 = applyBaseFilters(db.from('jawaban_ujian').select('*', { count: 'exact' }).order('created_at', { ascending: false }));
            if (_st === 'AKTIF') q2 = q2.not('status', 'like', 'SELESAI%');
            else if (_st === 'SELESAI') q2 = q2.like('status', 'SELESAI%');
            else if (_st === 'PELANGGARAN') q2 = q2.neq('pelanggaran', '0').neq('pelanggaran', '');
            const res2 = await q2.range(startIdx, startIdx + ITEMS_PER_PAGE - 1);
            data = res2.data; error = res2.error;
        }
    }

    // cntBelum sudah dihitung dari total RPC sebelum filter status (di atas) — jangan hitung ulang di sini
    // biar klik card AKTIF/SELESAI/PELANGGARAN tidak mengubah angka card BELUM
    if (error || !data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px; color:var(--text-muted);">Belum ada data sesuai filter.</td></tr>';
        const pi=document.getElementById('mon-page-info'); if(pi) pi.innerText = 'Menampilkan 0 dari 0';
        if (!adaUjianAktif && totalItems === 0 && cntAktif === 0 && cntSelesai === 0) {
            banner.style.display = 'flex'; banner.innerHTML = '<i class="fas fa-info-circle"></i>&nbsp; Tidak ada ujian yang aktif saat ini.';
        } else {
            banner.style.display = 'none';
        }
        if (typeof updatePaginationMonitoring === 'function') try{ updatePaginationMonitoring(totalItems); }catch(e){}
        _setMonLoading(false, _isSilent); isLoadingMonitoring=false;
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

    // Diagnostik: biar klik card yang "tidak terjadi apa-apa" bisa dibuktikan dari console
    try{ console.log('[mon] render status=' + _st + ' rows=' + (data ? data.length : 0) + ' total=' + totalItems); }catch(e){}
    const highlight = (text, q) => { try{ return (q && text) ? String(text).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), match => `<mark style="background-color: yellow; padding: 0;">${match}</mark>`) : (text || ''); }catch(e){ return text || ''; } };

    // row-level blur: deteksi status berubah vs sebelumnya
    const _newMap = new Map();
    let _monSkipRows = 0;
    sortedData.forEach((s, i) => {
        try{
        const isBelum = s.is_belum === true || String(s.status)==='BELUM MENGERJAKAN';
        const isSelesai = String(s.status).startsWith('SELESAI');
        const isPlg = parseInt(s.pelanggaran) > 0;
        const prev = _prevMonDataMap.get(String(s.id));
        const statusChanged = prev && prev.status !== s.status || prev && prev.pelanggaran !== s.pelanggaran;

        let statusBadge = "";
        if (isBelum) {
            statusBadge = `<span class="badge" style="background:rgba(100,116,139,0.15);color:#94a3b8;border:1px solid rgba(100,116,139,0.3);white-space:nowrap;display:inline-block;font-size:11px;letter-spacing:0.3px;">⏳ BELUM MENGERJAKAN</span>`;
        } else if (String(s.status).startsWith('PELANGGARAN')) {
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

        let waktu = '-';
        try{ if(s.created_at){ const _dt = new Date(s.created_at); if(!isNaN(_dt.getTime())) waktu = _dt.toLocaleTimeString('id-ID'); } }catch(e){ waktu = '-'; }
        const displayNama = highlight(s.nama, searchName);

        const safeNama = (s.nama||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
        const hapusBtn = _monIsAdmin
            ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:11px;color:#ef4444;border-color:rgba(239,68,68,0.3);" onclick="hapusDataNilai(${s.id}, '${safeNama}')" title="Hapus Data Siswa">
                    <i class="fas fa-trash"></i> Hapus
               </button>`
            : '';

        // blur hanya status berubah
        const rowBlurClass = statusChanged ? ' row-updating' : '';
        const displayKelas = (s.kelas||'').includes('::') ? s.kelas.split('::')[1] : s.kelas;
        // BELUM tidak bisa dihapus (belum ada row), hide checkbox & hapus
        const showCheck = !isBelum;
        const showHapus = !isBelum && _monIsAdmin;
        tbody.innerHTML += `
            <tr data-id="${s.id}" class="${rowBlurClass.trim()}" style="${!isSelesai && !isBelum ? 'background:rgba(250,204,21,0.06);' : ''}">
                <td data-label="" style="text-align:center;">${showCheck ? `<input type="checkbox" class="cb-monitoring" value="${s.id}">` : ''}</td>
                <td data-label="No" style="text-align:center;">${startIdx + i + 1}</td>
                <td data-label="Nama Siswa" style="font-weight:600;">
                    <span class="mon-no-mobile" style="display:none; width:26px; height:26px; background:rgba(59,130,246,.14); border:1px solid rgba(59,130,246,.28); border-radius:7px; align-items:center; justify-content:center; font-size:12px; font-weight:800; color:#93c5fd; flex-shrink:0;">${startIdx + i + 1}</span>
                    <span class="mon-nama-text">${displayNama}</span>
                </td>
                <td data-label="Kelas / Mapel" style="text-align:center;">
                    <span class="badge" style="display:inline-block;margin-bottom:3px;">${displayKelas}</span><br>
                    <span style="font-size:12px;color:var(--text-muted);font-weight:600;">${s.mapel}</span>
                </td>
                <td data-label="Status" data-col="status" style="text-align:center;">${statusBadge}</td>
                <td data-label="Pelanggaran" style="text-align:center;">${isBelum ? '<span style="color:#94a3b8;">-</span>' : plgBadge}</td>
                <td data-label="Waktu Mulai" style="text-align:center; font-size:12px; color:var(--text-muted);">${waktu}</td>
                <td data-label="Aksi" style="text-align:center;">${showHapus ? hapusBtn : ''}</td>
            </tr>`;
        _newMap.set(String(s.id), { status: s.status, pelanggaran: s.pelanggaran });
        }catch(rowErr){ _monSkipRows++; try{ console.warn('[monitoring] skip baris rusak id=', s && s.id, rowErr); }catch(e){} }
    });
    if(_monSkipRows > 0){ try{ console.warn('[monitoring] total baris di-skip: ' + _monSkipRows); }catch(e){} }
    _prevMonDataMap = _newMap;
    // hilangkan blur setelah animasi
    setTimeout(()=>{ document.querySelectorAll('.row-updating').forEach(el=> el.classList.remove('row-updating')); }, 700);

    const _elAktif2=document.getElementById('mon-aktif'); if(_elAktif2) _elAktif2.innerText = String(cntAktif);
    const _elSelesai2=document.getElementById('mon-selesai'); if(_elSelesai2) _elSelesai2.innerText = String(cntSelesai);
    const _elPlg2=document.getElementById('mon-pelanggaran'); if(_elPlg2) _elPlg2.innerText = String(cntPelanggaran);
    try{ if(typeof syncDashboardSedangFromMonitoring==='function') syncDashboardSedangFromMonitoring(cntAktif, filterKelas, filterMapel, searchName, filterTglAwal, filterTglAkhir); }catch(_){}
    try{ if(typeof syncLandingSiswaAktifFromMonitoring==='function') syncLandingSiswaAktifFromMonitoring(cntAktif, filterKelas, filterMapel, searchName, filterTglAwal, filterTglAkhir); }catch(_){}
    try{ const _isGlobalZ = !filterKelas && !filterMapel && !searchName && !filterTglAwal && !filterTglAkhir; if(_isGlobalZ){ const _deZ=document.getElementById('tot-sedang-ujian'); if(_deZ) _deZ.innerText = String(cntAktif); const _leZ=document.getElementById('landing-siswa-aktif'); if(_leZ) _leZ.innerText = String(cntAktif); } }catch(_){}
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
    }catch(e){ console.warn('[monitoring] load error',e); }finally{
        _setMonLoading(false, _isSilent); isLoadingMonitoring=false;
        if(_pendingMonReload){
            const _nextSilent = _pendingMonSilent;
            _pendingMonReload=false; _pendingMonSilent=false;
            // delay sedikit biar UI sempat update, lalu reload dengan filter terbaru (AKTIF/SELESAI)
            setTimeout(()=>{ if(typeof loadMonitoring==='function') loadMonitoring(_nextSilent ? {silent:true} : {}); }, 80);
        }
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

// Sinkron chip sortbar mobile dengan sortState (dipanggil tiap render)
function syncMonSortChips() {
    try {
        const st = (typeof sortState !== 'undefined' && sortState.monitoring) ? sortState.monitoring : { column: null, direction: 'asc' };
        document.querySelectorAll('#mon-sortbar [data-sortcol]').forEach(ch => {
            const col = ch.dataset.sortcol;
            const base = ch.dataset.label || col;
            const active = st.column === col;
            ch.classList.toggle('active', active);
            ch.textContent = base + (active ? (st.direction === 'asc' ? ' ↑' : ' ↓') : '');
        });
    } catch (e) {}
}

function sortMonitoringData(data) {
    const col = sortState.monitoring.column;
    const dir = sortState.monitoring.direction;
    if (!col) { syncMonSortChips(); return data; }

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
            case 'status': {
                // Urutan status: BELUM(0) → MENGERJAKAN(1) → PELANGGARAN(2) → SELESAI(3)
                // asc (↑): BELUM, MENGERJAKAN, PELANGGARAN, SELESAI — desc (↓): sebaliknya
                const rankStatus = (s) => {
                    if (s.is_belum === true || String(s.status) === 'BELUM MENGERJAKAN') return 0;
                    const st = String(s.status || '').toUpperCase();
                    if (st.startsWith('SELESAI')) return 3;
                    if (st.startsWith('PELANGGARAN')) return 2;
                    return 1;
                };
                const rA = rankStatus(a), rB = rankStatus(b);
                if (rA !== rB) return dir === 'asc' ? rA - rB : rB - rA;
                const tA = new Date(a.created_at || '').getTime() || 0;
                const tB = new Date(b.created_at || '').getTime() || 0;
                if (tA !== tB) return dir === 'asc' ? tA - tB : tB - tA;
                return dir === 'asc'
                    ? String(a.nama || '').localeCompare(String(b.nama || ''))
                    : String(b.nama || '').localeCompare(String(a.nama || ''));
            }
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
    syncMonSortChips();
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
    const cards = { 'AKTIF': document.getElementById('mon-card-aktif'), 'SELESAI': document.getElementById('mon-card-selesai'), 'PELANGGARAN': document.getElementById('mon-card-pelanggaran'), 'BELUM': document.getElementById('mon-card-belum') };
    Object.entries(cards).forEach(([status, card]) => {
        if (card) { card.style.borderWidth = '2px'; card.style.background = status === 'AKTIF' ? 'rgba(16,185,129,0.04)' : status === 'SELESAI' ? 'rgba(59,130,246,0.04)' : status === 'BELUM' ? 'rgba(100,116,139,0.04)' : 'rgba(239,68,68,0.04)'; }
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
        // catat ke reset-log → satu-satunya pemicu reset resmi di HP siswa (bukan sinyal/realtime)
        try { if (typeof catatResetSiswa === 'function') catatResetSiswa(backupData); } catch (e) {}
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
        // catat ke reset-log → satu-satunya pemicu reset resmi di HP siswa
        try { if (typeof catatResetSiswa === 'function') catatResetSiswa(savedData ? [savedData] : []); } catch (e) {}
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
// NOTE: handleUploadDarurat PINDAH ke admin-laporan.js (tombolnya ada di halaman Laporan Nilai).
// Ditaruh di sini dulu tidak jalan kalau modul monitoring belum dibuka (lazy-load).
