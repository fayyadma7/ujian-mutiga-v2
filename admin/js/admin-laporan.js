// @ts-nocheck
// ============================================================
// admin-laporan.js — Laporan Nilai Section
// Functions: loadNilaiSiswa, exportLaporan, exportNilaiWord,
//            clearFilterLaporan, clearSortLaporan, sortLaporanData,
//            hapusDataNilai, bulkActionNilai, toggleSortLaporan,
//            exportExcel
// ============================================================

var _lapMapelCache = typeof _lapMapelCache !== 'undefined' ? _lapMapelCache : [];

function _setLapLoading(on){
    const ov=document.getElementById('laporan-loading-overlay');
    if(ov){ ov.classList.toggle('show', !!on); ov.setAttribute('aria-hidden', on?'false':'true'); }
}
// --- LAPORAN UTAMA ---
async function loadNilaiSiswa() {
    const tbody = document.getElementById('tabel-data-nilai');
    const selectMapel = document.getElementById('filter-mapel-laporan');
    const selectKelas = document.getElementById('filter-kelas-laporan');
    const _lapSesi = getGuruSession();
    const _lapIsAdmin = _lapSesi && _lapSesi.isAdmin === true;
    const _lapGuruId = _lapSesi ? _lapSesi.id : null;

    let filterMapel = selectMapel ? selectMapel.value : '';
    let filterKelas = selectKelas ? selectKelas.value : '';
    const searchNameLap = document.getElementById('search-nama-laporan')?.value.toLowerCase() || '';
    const filterTglAwalLap = document.getElementById('filter-tgl-awal-laporan')?.value || '';
    const filterTglAkhirLap = document.getElementById('filter-tgl-akhir-laporan')?.value || '';

    _setLapLoading(true);
    const _hadLapRows = tbody && (tbody.querySelectorAll('tr').length>1 || (tbody.textContent && !tbody.textContent.includes('Memuat') && !tbody.textContent.includes('mengambil')));
    if(tbody && !_hadLapRows){
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Memuat...</td></tr>';
    }

    // Guru: ambil daftar mapel miliknya untuk filter (HARUS dari bank_soal yang terdaftar)
    let allowedMapels = null;
    if (!_lapIsAdmin && _lapGuruId) {
        const { data: mySoal } = await db.from('bank_soal').select('mapel').eq('created_by', _lapGuruId);
        if (mySoal) allowedMapels = [...new Set(mySoal.map(d => (d.mapel || '').trim()).filter(Boolean))].sort();
        else allowedMapels = [];
    }

    // Populate dropdown filter — COMPREHENSIVE: bank_soal + riwayat jawaban_ujian + jadwal_ujian
    if (selectMapel && selectKelas) {
        let mapelList = [];
        if (allowedMapels !== null) {
            mapelList = allowedMapels;
        } else {
            try {
                const { data: allMapel } = await db.from('bank_soal').select('mapel');
                const s = new Set();
                (allMapel || []).forEach(d => { if (d.mapel) s.add(d.mapel.trim()); });
                mapelList = [...s].sort();
            } catch (_) { mapelList = []; }
        }
        // — gabungkan riwayat agar mapel pernah diujikan tetap muncul di pencarian
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
        let kelasList = [];
        try {
            const { data: kelasRaw } = await db.from('kelas').select('nama').eq('is_aktif', true).order('nama', { ascending: true });
            const s = new Set();
            (kelasRaw || []).forEach(r => { if (r.nama) s.add(r.nama.trim()); });
            kelasList = [...s].sort();
        } catch (_) { kelasList = []; }

        selectMapel.innerHTML = '<option value="">Semua Mapel</option>';
        mapelList.forEach(m => { const opt = document.createElement('option'); opt.value = m; opt.textContent = m; selectMapel.appendChild(opt); });
        if (mapelList.includes(filterMapel)) selectMapel.value = filterMapel;
        else { selectMapel.value = ''; filterMapel = ''; }

        selectKelas.innerHTML = '<option value="">Semua Kelas</option>';
        kelasList.forEach(k => { const opt = document.createElement('option'); opt.value = k; opt.textContent = k; selectKelas.appendChild(opt); });
        if (kelasList.includes(filterKelas)) selectKelas.value = filterKelas;
        else { selectKelas.value = ''; filterKelas = ''; }

        if (typeof syncCustomSelect === 'function') {
            syncCustomSelect('filter-kelas-laporan');
        }
        // searchable mapel — compact (mirip analisis)
        try{
            _lapMapelCache = [...mapelList];
            const selLap = document.getElementById('filter-mapel-laporan');
            const inpLap = document.getElementById('filter-mapel-laporan-search');
            const ddLap = document.getElementById('filter-mapel-laporan-dropdown');
            if (selLap && inpLap) {
                if (selLap.value) inpLap.value = selLap.value;
                else if (!inpLap.dataset.userTyped) inpLap.value = '';
            }
            // hapus csl lama
            document.querySelectorAll('.csl-container').forEach(c=>{
                const s=selLap;
                if(s && c.contains(s)){
                    const b=c.querySelector('.csl-btn'); if(b) b.remove();
                    const d=c.querySelector('.csl-dropdown'); if(d && d.id!=='filter-mapel-laporan-dropdown') d.remove();
                    if(c.children.length===1 && c.contains(s)){
                        const par=c.parentNode; if(par){ par.insertBefore(s, c); c.remove(); }
                    } else c.style.display='none';
                    delete s.dataset.cslReady;
                }
            });
            if(selLap){ selLap.style.display='none'; selLap.classList.remove('csl-native'); delete selLap.dataset.cslReady; }
            document.querySelectorAll('#filter-mapel-laporan-csldd').forEach(el=> el.remove());
            if (inpLap && ddLap) {
                if (!inpLap.dataset.lapSearchReady) {
                    inpLap.dataset.lapSearchReady='1';
                    inpLap.addEventListener('input', ()=>{ inpLap.dataset.userTyped='1'; renderLapMapelDropdown(inpLap.value); ddLap.style.display='block'; });
                    inpLap.addEventListener('focus', ()=>{
                        const v=(inpLap.value||'').trim();
                        if(v) renderLapMapelDropdown(v);
                        else { ddLap.innerHTML='<div style="padding:8px; text-align:center; color:#64748b; font-size:11px;">Cari Mapel</div>'; ddLap.style.display='block'; }
                    });
                    inpLap.addEventListener('blur', ()=> setTimeout(()=>{
                        ddLap.style.display='none';
                        // jangan auto-refresh saat blur/klik kosong — hanya hide, revert input ke nilai terpilih
                        const sel=document.getElementById('filter-mapel-laporan');
                        if(sel && inpLap){
                            const cur=sel.value||'';
                            // kembalikan tampilan input ke nilai filter yang aktif, tanpa trigger change
                            if((inpLap.value||'').trim() !== cur) inpLap.value = cur;
                        }
                    }, 180));
                    inpLap.addEventListener('keydown', (e)=>{
                        if(e.key==='Enter'){
                            e.preventDefault();
                            const typed=(inpLap.value||'').trim().toLowerCase();
                            const first=_lapMapelCache.find(m=> m.toLowerCase().includes(typed));
                            if(first) selectLapMapel(first);
                        } else if(e.key==='Escape'){ ddLap.style.display='none'; inpLap.blur(); }
                    });
                    document.addEventListener('click', (e)=>{
                        if(!inpLap.contains(e.target) && !ddLap.contains(e.target)) ddLap.style.display='none';
                    });
                }
                ddLap.style.display='none';
            }
        }catch(e){}
    }

    // laporan: BELUM hanya jika user sudah pilih filter (kelas+mapel) dan ada jadwal untuk itu — jangan auto saat filter kosong (biar laporan tampil semua/history, tidak paksa Seni Budaya)
    let autoLapKelas = filterKelas;
    let autoLapMapel = filterMapel;
    let jadwalAktifLap = null;
    let useLapCampuran = false;
    try{
        const { data: jadLap } = await db.from('jadwal_ujian').select('kelas,mapel').eq('is_aktif', true);
        if(jadLap && jadLap.length && filterKelas && filterMapel){
            // hanya jika user sudah pilih keduanya — cek jadwal cocok, baru pakai campuran untuk tampilkan BELUM
            const hasJadwalForFilter = jadLap.some(j=>{
                if(j.mapel !== filterMapel) return false;
                let kls = j.kelas || ''; if(kls.includes('::')) kls = kls.split('::')[1];
                return kls.split(',').map(s=>s.trim()).includes(filterKelas);
            });
            if(hasJadwalForFilter){
                jadwalAktifLap = { kelas: filterKelas, mapel: filterMapel };
                useLapCampuran = true;
            } else {
                // tetap coba walau jadwal tidak exact (mis. is_aktif false tapi baru selesai) — biar BELUM tetap bisa muncul untuk filter yang dipilih
                jadwalAktifLap = { kelas: filterKelas, mapel: filterMapel };
                useLapCampuran = true;
            }
        }
    }catch(e){}

    let query = db.from('jawaban_ujian').select('*', { count: 'exact' });
    if (filterMapel) query = query.eq('mapel', filterMapel);
    else if (allowedMapels && allowedMapels.length > 0) query = query.in('mapel', allowedMapels);
    if (filterKelas) query = query.eq('kelas', filterKelas);
    if (searchNameLap) query = query.ilike('nama', `%${searchNameLap}%`);
    if (filterTglAwalLap) query = query.gte('created_at', filterTglAwalLap + 'T00:00:00');
    if (filterTglAkhirLap) query = query.lte('created_at', filterTglAkhirLap + 'T23:59:59');

    let currentPage = currentLapPage || 1;
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;

    let allData, totalCount, error;
    let _isLapCampuran = false;
    if(useLapCampuran){
        _isLapCampuran = true;
        try{
            const _s = getGuruSession(); const _gid = _s ? parseInt(_s.id) : null; const _isAdmin = _s ? !!_s.isAdmin : true;
            const { data: cntVal } = await db.rpc('get_live_campuran_count', { p_kelas: autoLapKelas || null, p_mapel: autoLapMapel || null, p_search: searchNameLap || null, p_guru_id: _gid, p_is_admin: _isAdmin });
            totalCount = cntVal || 0;
            const { data: rpcData, error: rpcErr } = await db.rpc('get_live_campuran', { p_kelas: autoLapKelas || null, p_mapel: autoLapMapel || null, p_search: searchNameLap || null, p_limit: ITEMS_PER_PAGE, p_offset: startIdx, p_guru_id: _gid, p_is_admin: _isAdmin });
            if(rpcErr) throw rpcErr;
            // rpc returns campur Sudah+BELUM already, map to laporan shape
            allData = (rpcData||[]).map(r=>({ id: r.siswa_id, nama: r.nama, kelas: r.kelas_nama, mapel: r.mapel, status: r.status, pelanggaran: r.pelanggaran === '-' ? 0 : r.pelanggaran, skor_pg: r.skor_pg, durasi: r.is_belum ? '-' : '-', created_at: r.created_at, is_belum: r.is_belum }));
            error = null;
        }catch(e){ _isLapCampuran=false; }
    }
    if(!_isLapCampuran){
        try{
            const res = await query.order('created_at', { ascending: false }).range(startIdx, startIdx + ITEMS_PER_PAGE - 1);
            allData=res.data; totalCount=res.count; error=res.error;
        }catch(e){ error=e; }
    }
    if (error) {
        _setLapLoading(false);
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#f87171;"><i class="fas fa-exclamation-triangle"></i> Gagal mengambil data!</td></tr>';
        return;
    }

    const finalTotal = totalCount || allData.length;
    const finalPages = Math.ceil(finalTotal / ITEMS_PER_PAGE) || 1;
    if (currentPage > finalPages) currentPage = finalPages;

    globalDataJawaban = allData || [];
    tempLaporanData = allData || [];

    const pageInfo = document.getElementById('lap-page-info');
    if (pageInfo) {
        const start = startIdx + 1;
        const end = Math.min(startIdx + ITEMS_PER_PAGE, finalTotal);
        pageInfo.innerText = `Menampilkan ${start}-${end} dari ${finalTotal} siswa`;
    }

    tbody.innerHTML = '';
    if (!allData || allData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted);">Data tidak ditemukan.</td></tr>';
        _setLapLoading(false);
        return;
    }

    // Apply sorting
    const sortedData = typeof sortLaporanData === 'function' ? sortLaporanData(allData) : allData;

    const highlight = (text, q) => q ? text.replace(new RegExp(q, 'gi'), match => `<mark style="background-color:yellow;padding:0;">${match}</mark>`) : text;

    sortedData.forEach((siswa, index) => {
        const isBelumLap = siswa.is_belum === true || String(siswa.status)==='BELUM MENGERJAKAN';
        const displayNama = highlight(siswa.nama, searchNameLap);
        const safeNama2 = (siswa.nama||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
        const hapusBtn = (!isBelumLap && _lapIsAdmin)
            ? `<button class="btn btn-outline" style="padding:4px 8px;font-size:11px;color:#ef4444;border-color:rgba(239,68,68,0.3);" onclick="hapusDataNilai(${siswa.id}, '${safeNama2}')" title="Hapus Data">
                    <i class="fas fa-trash"></i> Hapus
               </button>`
            : '';
        const statusBadgeLap = isBelumLap
            ? `<span class="badge" style="background:rgba(100,116,139,0.15);color:#94a3b8;border:1px solid rgba(100,116,139,0.3);white-space:nowrap;display:inline-block;font-size:11px;">⏳ BELUM MENGERJAKAN</span>`
            : `<span class="badge" style="background:${String(siswa.status).includes('PELANGGARAN') ? '#fee2e2' : '#d1fae5'};color:${String(siswa.status).includes('PELANGGARAN') ? '#ef4444' : '#065f46'};border:none;white-space:nowrap;display:inline-block;font-size:11px;letter-spacing:0.3px;">${siswa.status || 'SELESAI'}</span>`;
        const skorDisplay = isBelumLap ? '-' : (siswa.skor_pg !== null ? siswa.skor_pg : '-');
        const plgDisplay = isBelumLap ? '<span style="color:#94a3b8;">-</span>' : ((siswa.pelanggaran || 0) > 0
                        ? `<button onclick="lihatPelanggaran(${siswa.id}, '${(siswa.nama||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;')}')" title="Lihat Detail Pelanggaran" style="background:none;border:none;cursor:pointer;padding:2px 6px;border-radius:6px;transition:background 0.2s;font-size:12px;font-weight:600;color:#ef4444;text-decoration:underline;text-underline-offset:2px;" onmouseover="this.style.background='rgba(239,68,68,0.12)'" onmouseout="this.style.background='none'"><i class="fas fa-exclamation-triangle"></i> ${siswa.pelanggaran} Pelanggaran</button>`
                        : `<span style="font-size:12px;font-weight:600;color:#10b981;"><i class="fas fa-check-circle"></i> Bersih</span>`);
        tbody.innerHTML += `
            <tr>
                <td data-label="" style="text-align:center;">${isBelumLap ? '' : `<input type="checkbox" class="cb-laporan" value="${siswa.id}">`}</td>
                <td data-label="No" style="text-align:center;">${startIdx + index + 1}</td>
                <td data-label="Nama Siswa" style="font-weight:600;">
                    <span class="mon-no-mobile" style="display:none; width:26px; height:26px; background:rgba(59,130,246,.14); border:1px solid rgba(59,130,246,.28); border-radius:7px; align-items:center; justify-content:center; font-size:12px; font-weight:800; color:#93c5fd; flex-shrink:0;">${startIdx + index + 1}</span>
                    <span class="mon-nama-text">${displayNama}</span>
                </td>
                <td data-label="Kelas / Mapel" style="text-align:center;">
                    <span class="badge" style="display:inline-block;margin-bottom:4px;">${(siswa.kelas||'').includes('::') ? siswa.kelas.split('::')[1] : siswa.kelas}</span><br>
                    <span style="font-size:12px;color:var(--text-muted);font-weight:600;">${siswa.mapel}</span>
                </td>
                <td data-label="Skor PG" style="text-align:center;font-weight:700;color:var(--primary);font-size:16px;"><span class="skor-value">${skorDisplay}</span></td>
                <td data-label="Durasi & Pelanggaran" style="text-align:center;">
                    <span style="font-size:13px;color:var(--text-main);">${siswa.durasi || '-'}</span><br>
                    ${plgDisplay}
                </td>
                <td data-label="Status" style="text-align:center;">
                    ${statusBadgeLap}
                </td>
                <td data-label="Aksi" style="text-align:center;">${hapusBtn}</td>
            </tr>
        `;
    });
    _setLapLoading(false);
}

// --- SORTING ---
function toggleSortLaporan(column) {
    const current = sortState.laporan;
    if (current.column === column) current.direction = current.direction === 'asc' ? 'desc' : 'asc';
    else { current.column = column; current.direction = 'asc'; }
    currentLapPage = 1;
    loadNilaiSiswa();
}

function sortLaporanData(data) {
    const col = sortState.laporan.column;
    const dir = sortState.laporan.direction;
    if (!col) return data;

    const sorted = [...data].sort((a, b) => {
        let valA, valB;
        switch (col) {
            case 'nama': valA = (a.nama || '').toLowerCase(); valB = (b.nama || '').toLowerCase(); break;
            case 'kelas': valA = (a.kelas || '').toLowerCase(); valB = (b.kelas || '').toLowerCase(); break;
            case 'skor': valA = parseInt(a.skor_pg) || 0; valB = parseInt(b.skor_pg) || 0; break;
            case 'durasi': valA = (a.durasi || '').toLowerCase(); valB = (b.durasi || '').toLowerCase(); break;
            case 'status': valA = (a.status || '').toLowerCase(); valB = (b.status || '').toLowerCase(); break;
            default: return 0;
        }
        let result = 0;
        if (typeof valA === 'string') result = valA.localeCompare(valB);
        else result = valA > valB ? 1 : valA < valB ? -1 : 0;
        return dir === 'asc' ? result : -result;
    });

    if (typeof updateSortIndicators === 'function') updateSortIndicators('laporan');
    return sorted;
}

// --- SEARCHABLE MAPEL helpers (compact) ---
function renderLapMapelDropdown(filter){
    const dd=document.getElementById('filter-mapel-laporan-dropdown');
    if(!dd) return;
    const q=(filter||'').trim().toLowerCase();
    if(!q){
        dd.innerHTML='<div style="padding:8px; text-align:center; color:#64748b; font-size:11px;">Cari Mapel</div>';
        dd.style.display='block'; return;
    }
    const list=_lapMapelCache.filter(m=> m.toLowerCase().includes(q));
    if(!list.length){
        dd.innerHTML='<div style="padding:8px; text-align:center; color:#64748b; font-size:11px;">Tidak ada mapel cocok</div>';
        dd.style.display='block'; return;
    }
    dd.innerHTML=list.map(m=> `<div class="csl-option" style="padding:6px 10px; font-size:11px; cursor:pointer; border-radius:6px;" onmousedown="event.preventDefault(); selectLapMapel('${m.replace(/'/g,"\\'")}')">${m}</div>`).join('');
    dd.style.display='block';
}
function selectLapMapel(val){
    const sel=document.getElementById('filter-mapel-laporan');
    const inp=document.getElementById('filter-mapel-laporan-search');
    const dd=document.getElementById('filter-mapel-laporan-dropdown');
    if(sel){
        let exists=[...sel.options].some(o=>o.value===val);
        if(!exists){ const opt=document.createElement('option'); opt.value=val; opt.textContent=val; sel.appendChild(opt); }
        sel.value=val; sel.dispatchEvent(new Event('change',{bubbles:true}));
    }
    if(inp){ inp.value=val; inp.dataset.userTyped='1'; }
    if(dd) dd.style.display='none';
}

// --- CLEAR FILTERS ---
function clearFilterLaporan() {
    document.getElementById('search-nama-laporan').value = '';
    document.getElementById('filter-mapel-laporan').value = '';
    const inpLap=document.getElementById('filter-mapel-laporan-search');
    if(inpLap){ inpLap.value=''; inpLap.dataset.userTyped=''; }
    const ddLap=document.getElementById('filter-mapel-laporan-dropdown');
    if(ddLap) ddLap.style.display='none';
    document.getElementById('filter-kelas-laporan').value = '';
    document.getElementById('filter-tgl-awal-laporan').value = '';
    document.getElementById('filter-tgl-akhir-laporan').value = '';
    document.getElementById('date-filter-label-laporan').textContent = 'Semua Tanggal';
    syncCustomSelect('filter-kelas-laporan');
    currentLapPage = 1;
    loadNilaiSiswa();
}

function clearSortLaporan() {
    sortState.laporan.column = null;
    sortState.laporan.direction = 'asc';
    if (typeof updateSortIndicators === 'function') updateSortIndicators('laporan');
    currentLapPage = 1;
    loadNilaiSiswa();
}

// --- BULK ACTIONS ---

async function hapusDataNilai(id, nama) {
    console.log('[hapusDataNilai] laporan id', id, nama);
    const s = getGuruSession();
    if (!s || s.isAdmin !== true) { console.log('hapusDataNilai laporan: not admin', s); showToast('Akses ditolak. Hanya Admin.', 'error'); return; }
    if (!await asyncConfirm(`Hapus data sesi/jawaban siswa "${nama}"?<br>Anda akan memiliki waktu untuk membatalkan tindakan ini.`, "Hapus Data Siswa?")) return;
    const { data: savedData } = await db.from('jawaban_ujian').select('*').eq('id', id).single();
    const { error } = await adminDb.delete('jawaban_ujian', id);
    if (error) showToast("Gagal menghapus: " + error.message, 'error');
    else {
        try{ const ch=db.channel('admin-kick'); ch.subscribe(async (st)=>{ if(st==='SUBSCRIBED'){ await ch.send({type:'broadcast', event:'kick', payload:{ids:[id]}}); setTimeout(()=>{ try{ db.removeChannel(ch);}catch(e){} }, 1200); } }); }catch(e){}
        const undoDelete = async () => {
            if (savedData) {
                const { error: insertError } = await adminDb.insert('jawaban_ujian', [savedData]);
                if (insertError) showToast("Gagal membatalkan penghapusan: " + insertError.message, 'error');
                else { showToast(`Data siswa "${nama}" berhasil dipulihkan`, 'success'); if(typeof loadNilaiSiswa==='function') loadNilaiSiswa(); if(typeof loadMonitoring==='function' && document.getElementById('monitoring')?.classList.contains('active')) loadMonitoring(); }
            }
        };
        showToast(`Data siswa "${nama}" berhasil dihapus`, 'success', undoDelete, 'Batalkan');
        if(typeof loadNilaiSiswa==='function') loadNilaiSiswa();
        if(typeof loadMonitoring==='function' && document.getElementById('monitoring')?.classList.contains('active')) loadMonitoring();
    }
}

async function bulkActionNilai(action) {
    const s = getGuruSession();
    if (!s || s.isAdmin !== true) { showToast('Akses ditolak. Hanya Admin.', 'error'); return; }
    const ids = Array.from(document.querySelectorAll('.cb-laporan:checked')).map(cb => cb.value);
    if (ids.length === 0) return showToast("Pilih minimal satu data!", 'info');
    const confirmed = await asyncConfirm(`Hapus <b>${ids.length} data nilai</b> terpilih?`, "Hapus Nilai Siswa?");
    if (!confirmed) { showToast("Hapus nilai siswa dibatalkan", 'info'); return; }
    const { data: backupData } = await db.from('jawaban_ujian').select('*').in('id', ids);
    const { error: lBatchErr } = await adminDb.batchDelete('jawaban_ujian', ids);
    if (lBatchErr) { showToast("Gagal menghapus: " + lBatchErr.message, 'error'); return; }
    try{ const ch=db.channel('admin-kick'); ch.subscribe(async (st)=>{ if(st==='SUBSCRIBED'){ await ch.send({type:'broadcast', event:'kick', payload:{ids}}); setTimeout(()=>{ try{ db.removeChannel(ch);}catch(e){} }, 1200); } }); }catch(e){}
    const undoFunc = async () => {
        if (backupData && backupData.length > 0) { await chunkedInsert('jawaban_ujian', backupData); loadNilaiSiswa(); showToast(`${ids.length} data nilai berhasil di-restore`, 'success'); }
    };
    showToast(`${ids.length} data nilai berhasil dihapus`, 'success', undoFunc, 'Undo');
    loadNilaiSiswa();
}

// --- EXPORT ---
async function exportExcel() {
    if (typeof XLSX === 'undefined') {
        try { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'); }
        catch (err) { return showToast('Gagal memuat library Excel', 'error'); }
    }
    const mapel = (document.getElementById('filter-mapel-laporan')?.value || '').trim();
    const kelas = (document.getElementById('filter-kelas-laporan')?.value || '').trim();
    if (!mapel) {
        showToast("Silakan pilih 'Mapel' terlebih dahulu di dropdown filter sebelum mengekspor. Kelas opsional — kosongkan untuk ekspor semua kelas pada mapel tersebut.", 'info');
        return;
    }
    let _q = db.from('jawaban_ujian').select('*').eq('mapel', mapel);
    if (kelas) _q = _q.eq('kelas', kelas);
    _q = _q.order('kelas', { ascending: true }).order('nama', { ascending: true });
    const { data, error } = await _q;
    if (error || !data || data.length === 0) { showToast("Tidak ada data nilai untuk diekspor.", 'error'); return; }

    // Ambil nomor soal essay untuk mapping jawaban legacy "|||" tanpa nomor
    let essayNos = [];
    try {
        const { data: soalList } = await db.from('bank_soal').select('tipe_soal').eq('mapel', mapel).order('id', { ascending: true });
        if (soalList) soalList.forEach((s, idx) => { if (s.tipe_soal === 'ESSAY') essayNos.push(idx + 1); });
    } catch(_) {}

    const strukturData = [["No", "Nama Siswa", "Kelas", "Mata Pelajaran", "Skor PG", "Jawaban Essay", "Durasi Pengerjaan", "Jumlah Pelanggaran", "Detail Pelanggaran", "Status Akhir", "Waktu Selesai"]];
    data.forEach((s, index) => {
        let essayCell = '-';
        if (s.jawaban_essay && String(s.jawaban_essay).trim() !== '') {
            let raw = String(s.jawaban_essay).replace(/\r\n/g, '\n').trim();
            let parts = [];
            if (raw.includes('|||')) {
                parts = raw.split('|||').map(p => p.trim()).filter(Boolean);
                parts = parts.map((p, i) => {
                    if (/^No\.\s*\d+\s*:/i.test(p)) return p;
                    // legacy: mapping ke nomor essay sebenarnya (No.2, No.5, dst) jika diketahui
                    const realNo = essayNos[i] || (i + 1);
                    // hilangkan prefix angka mentah "1: xxx" jika ada
                    const cleaned = p.replace(/^\d+\s*[:\.]\s*/, '');
                    return `No.${realNo}: ${cleaned}`;
                });
            } else if (raw.includes('\n')) {
                parts = raw.split('\n').map(p => p.trim()).filter(Boolean);
            } else {
                parts = [raw];
                if (!/^No\.\s*\d+\s*:/i.test(raw)) {
                    const realNo = essayNos[0] || 1;
                    parts = [`No.${realNo}: ${raw}`];
                }
            }
            essayCell = parts.join('\n');
        }
        strukturData.push([index + 1, s.nama, s.kelas, s.mapel, s.skor_pg !== null ? s.skor_pg : 0, essayCell, s.durasi || '-', s.pelanggaran || 0, s.log_pelanggaran || '-', s.status || 'SELESAI', s.created_at ? new Date(s.created_at).toLocaleString('id-ID') : '-']);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(strukturData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Laporan Nilai");
    worksheet['!cols'] = [{ wch: 5 }, { wch: 35 }, { wch: 15 }, { wch: 20 }, { wch: 10 }, { wch: 55 }, { wch: 20 }, { wch: 18 }, { wch: 60 }, { wch: 30 }, { wch: 25 }];
    // Wrap text untuk kolom Jawaban Essay (F) agar \n tampil sebagai baris baru
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    for (let r = 1; r <= range.e.r; r++) {
        const addr = XLSX.utils.encode_cell({ r, c: 5 });
        if (worksheet[addr]) {
            if (!worksheet[addr].s) worksheet[addr].s = {};
            worksheet[addr].s.alignment = { wrapText: true, vertical: 'top' };
        }
    }
    // Tinggi baris auto (minimal 40 untuk essay)
    if (!worksheet['!rows']) worksheet['!rows'] = [];
    for (let r = 1; r <= range.e.r; r++) {
        const essayVal = strukturData[r] ? strukturData[r][5] : '';
        const lineCount = essayVal ? String(essayVal).split('\n').length : 1;
        worksheet['!rows'][r] = { hpt: Math.max(20, lineCount * 15) };
    }
    const safeMapel = mapel.replace(/\s+/g, '_');
    const safeKelas = kelas ? kelas.replace(/\s+/g, '_') : 'SemuaKelas';
    XLSX.writeFile(workbook, `Nilai_${safeMapel}_${safeKelas}.xlsx`, { cellStyles: true });
}

async function exportLaporan() { return exportExcel(); }

// --- ALIAS untuk tombol Hapus Data Terpilih (admin_pro.html memanggil bulkActionLaporan) ---
async function bulkActionLaporan(action){ return bulkActionNilai(action); }

async function exportNilaiWord() {
    // Placeholder — Word export for laporan can be added if needed
    showToast("Fungsi export Word untuk laporan belum tersedia.", 'info');
}
