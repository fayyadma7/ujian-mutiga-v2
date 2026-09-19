// @ts-nocheck
// ============================================================
// admin-analisis.js — Analisis Soal Section
// Functions: loadAnalisisData, loadAnalisisSoal, renderChart,
//            renderDistribusi, renderTingkatKesulitan,
//            populateAnalisisFilters, analisisSoal
// Update 2026: Mapel filter jadi searchable input (mirip jadwal)
//          + hitung kesukaran nyata B dari N (PG only, Essay dikecualikan)
// ============================================================

let myChart = null;
let _anaMapelCache = [];
let _anaLastSoal = [];
let _anaLastPeserta = [];
let _anaLastBenarMap = new Map();
let _anaLastTotal = 0;
let _anaLastMapel = '';

async function populateAnalisisFilters() {
    const selectMapel = document.getElementById('ana-filter-mapel');
    const selectKelas = document.getElementById('ana-filter-kelas');
    const searchInput = document.getElementById('ana-filter-mapel-search');
    const dropdown = document.getElementById('ana-filter-mapel-dropdown');
    if (!selectMapel || !selectKelas) return;
    const sesi = getGuruSession();
    const isAdmin = sesi && sesi.isAdmin === true;
    const guruId = sesi ? sesi.id : null;

    // Mapel HARUS dari bank_soal yang terdaftar (master), bukan dari jawaban_ujian
    let mapelFilter = null;
    if (!isAdmin && guruId) {
        const { data: mySoal } = await db.from('bank_soal').select('mapel').eq('created_by', guruId);
        if (mySoal) mapelFilter = [...new Set(mySoal.map(d => (d.mapel||'').trim()).filter(Boolean))].sort();
        else mapelFilter = [];
    }

    let mapels = [];
    if (mapelFilter !== null) {
        mapels = mapelFilter;
    } else {
        try {
            const { data: allMapel } = await db.from('bank_soal').select('mapel').order('mapel', { ascending: true });
            const s = new Set();
            (allMapel || []).forEach(d => { if (d.mapel) s.add(d.mapel.trim()); });
            mapels = [...s].sort();
        } catch (_) { mapels = []; }
    }
    // — COMPREHENSIVE: tambah riwayat agar mapel pernah diujikan tetap muncul di pencarian
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
        const compSet = new Set(mapels);
        (jwbRows||[]).forEach(r=>{ if(r.mapel) compSet.add(r.mapel.trim()); });
        (jadRows||[]).forEach(r=>{ if(r.mapel) compSet.add(r.mapel.trim()); });
        mapels = [...compSet].sort((a,b)=>a.localeCompare(b,'id'));
    }catch(_){}

    // Kelas HARUS dari tabel kelas master (is_aktif true), bukan dari jawaban_ujian
    let kelass = [];
    try {
        const { data: kelasRaw } = await db.from('kelas').select('nama').eq('is_aktif', true).order('nama', { ascending: true });
        const s = new Set();
        (kelasRaw || []).forEach(r => { if (r.nama) s.add(r.nama.trim()); });
        kelass = [...s].sort();
    } catch (_) { kelass = []; }

    const curM = selectMapel.value;
    const curK = selectKelas.value;

    // isi cache & hidden select mapel
    _anaMapelCache = [...mapels];
    selectMapel.innerHTML = '<option value="">Semua Mapel</option>';
    mapels.forEach(m => { const opt = document.createElement('option'); opt.value = m; opt.textContent = m; selectMapel.appendChild(opt); });

    selectKelas.innerHTML = '<option value="">Semua Kelas</option>';
    kelass.forEach(k => { const opt = document.createElement('option'); opt.value = k; opt.textContent = k; selectKelas.appendChild(opt); });

    if (mapels.includes(curM)) selectMapel.value = curM;
    else selectMapel.value = '';

    if (kelass.includes(curK)) selectKelas.value = curK;
    else selectKelas.value = '';

    // sync search input dengan value terpilih
    if (searchInput) {
        if (selectMapel.value) searchInput.value = selectMapel.value;
        else if (!searchInput.dataset.userTyped) searchInput.value = '';
    }

    // hapus csl lama untuk ana-filter-mapel (jangan duplikat)
    try{
        document.querySelectorAll('.csl-container').forEach(c=>{
            if(c.contains(selectMapel)){
                const b=c.querySelector('.csl-btn'); if(b) b.remove();
                const d=c.querySelector('.csl-dropdown'); if(d && d.id!=='ana-filter-mapel-dropdown') d.remove();
                if(c.children.length===1 && c.contains(selectMapel)){
                    const par=c.parentNode;
                    if(par){ par.insertBefore(selectMapel, c); c.remove(); }
                } else {
                    c.style.display='none';
                }
                delete selectMapel.dataset.cslReady;
            }
        });
        selectMapel.style.display='none';
        selectMapel.classList.remove('csl-native');
        delete selectMapel.dataset.cslReady;
        document.querySelectorAll('#ana-filter-mapel-csldd').forEach(el=> el.remove());
    }catch(e){}

    // setup searchable dropdown untuk mapel (hanya sekali)
    if (searchInput && dropdown) {
        if (!searchInput.dataset.anaSearchReady) {
            searchInput.dataset.anaSearchReady='1';
            searchInput.addEventListener('input', ()=>{ searchInput.dataset.userTyped='1'; renderAnaMapelDropdown(searchInput.value); dropdown.style.display='block'; });
            searchInput.addEventListener('focus', ()=>{
                const v=(searchInput.value||'').trim();
                if(v) renderAnaMapelDropdown(v);
                else {
                    dropdown.innerHTML='<div style="padding:10px; text-align:center; color:#64748b; font-size:12px;">Cari Mapel</div>';
                    dropdown.style.display='block';
                }
            });
            searchInput.addEventListener('blur', ()=> setTimeout(()=>{
                dropdown.style.display='none';
                const typed=(searchInput.value||'').trim();
                const sel=document.getElementById('ana-filter-mapel');
                if(!typed){ if(sel){ sel.value=''; sel.dispatchEvent(new Event('change',{bubbles:true})); } return; }
                const exact=_anaMapelCache.find(m=> m.toLowerCase()===typed.toLowerCase());
                if(exact){
                    selectAnaMapel(exact);
                } else {
                    const hasExact=_anaMapelCache.some(m=> m.toLowerCase()===typed.toLowerCase());
                    if(!hasExact && sel){ sel.value=''; sel.dispatchEvent(new Event('change',{bubbles:true})); }
                }
            }, 180));
            searchInput.addEventListener('keydown', (e)=>{
                if(e.key==='Enter'){
                    e.preventDefault();
                    const typed=(searchInput.value||'').trim().toLowerCase();
                    const first=_anaMapelCache.find(m=> m.toLowerCase().includes(typed));
                    if(first) selectAnaMapel(first);
                } else if(e.key==='Escape'){ dropdown.style.display='none'; searchInput.blur(); }
            });
            document.addEventListener('click', (e)=>{
                if(!searchInput.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display='none';
            });
        }
        dropdown.style.display='none';
    }

    // Kelas tetap dropdown biasa
    if (typeof initCustomSelect === 'function') {
        initCustomSelect('ana-filter-kelas');
    }
    if (typeof syncCustomSelect === 'function') {
        syncCustomSelect('ana-filter-kelas');
    }

    loadAnalisisData();
}

function renderAnaMapelDropdown(filter){
    const dropdown=document.getElementById('ana-filter-mapel-dropdown');
    if(!dropdown) return;
    const q=(filter||'').trim().toLowerCase();
    if(!q){
        dropdown.innerHTML='<div style="padding:10px; text-align:center; color:#64748b; font-size:12px;">Cari Mapel</div>';
        dropdown.style.display='block';
        return;
    }
    const list = _anaMapelCache.filter(m=> m.toLowerCase().includes(q));
    if(!list.length){
        dropdown.innerHTML='<div style="padding:10px; text-align:center; color:#64748b; font-size:12px;">Tidak ada mapel cocok</div>';
        dropdown.style.display='block';
        return;
    }
    dropdown.innerHTML = list.map(m=> `<div class="csl-option" style="padding:8px 12px; cursor:pointer; border-radius:6px;" onmousedown="event.preventDefault(); selectAnaMapel('${m.replace(/'/g,"\\'")}')">${m}</div>`).join('');
    dropdown.style.display='block';
}

function selectAnaMapel(val){
    const select=document.getElementById('ana-filter-mapel');
    const searchInput=document.getElementById('ana-filter-mapel-search');
    const dropdown=document.getElementById('ana-filter-mapel-dropdown');
    if(select){
        let exists=[...select.options].some(o=>o.value===val);
        if(!exists){
            const opt=document.createElement('option');
            opt.value=val; opt.textContent=val;
            select.appendChild(opt);
        }
        select.value=val;
        select.dispatchEvent(new Event('change',{bubbles:true}));
    }
    if(searchInput){ searchInput.value=val; searchInput.dataset.userTyped='1'; }
    if(dropdown) dropdown.style.display='none';
}

function clearAnaMapelSearch(){
    const select=document.getElementById('ana-filter-mapel');
    const searchInput=document.getElementById('ana-filter-mapel-search');
    const dropdown=document.getElementById('ana-filter-mapel-dropdown');
    if(select){ select.value=''; select.dispatchEvent(new Event('change',{bubbles:true})); }
    if(searchInput) searchInput.value='';
    if(dropdown) dropdown.style.display='none';
}

async function loadAnalisisSoal() { return loadAnalisisData(); }

async function loadAnalisisData() {
    // sync search input jika dipanggil tanpa via searchable (fallback)
    const searchInput = document.getElementById('ana-filter-mapel-search');
    const selectMapelEl = document.getElementById('ana-filter-mapel');
    if (searchInput && selectMapelEl && !searchInput.value && selectMapelEl.value) {
        searchInput.value = selectMapelEl.value;
    }

    const mapel = document.getElementById('ana-filter-mapel').value;
    const kelas = document.getElementById('ana-filter-kelas').value;
    const sesi = getGuruSession();
    const isAdmin = sesi && sesi.isAdmin === true;

    if (!mapel) return;

    // Guru: hanya bisa analisis mapel miliknya
    if (!isAdmin) {
        const { data: cek } = await db.from('bank_soal').select('id').eq('mapel', mapel).eq('created_by', sesi.id).limit(1);
        if (!cek || cek.length === 0) {
            document.getElementById('ana-rata').innerText = '-';
            document.getElementById('ana-tinggi').innerText = '-';
            document.getElementById('ana-rendah').innerText = '-';
            if (myChart) myChart.destroy();
            document.getElementById('tabel-analisis-soal').innerHTML = '<tr><td colspan="5" style="padding:30px;text-align:center;">Anda hanya bisa menganalisis mapel yang Anda buat.</td></tr>';
            document.getElementById('ana-total-soal').innerText = 'Total: 0 Soal';
            return;
        }
    }

    // 1. Statistik Nilai
    let queryNilai = db.from('jawaban_ujian').select('*').eq('mapel', mapel);
    if (kelas) queryNilai = queryNilai.eq('kelas', kelas);
    const { data: dataNilai } = await queryNilai;

    if (dataNilai && dataNilai.length > 0) {
        const skor = dataNilai.map(s => Number(s.skor_pg || 0));
        document.getElementById('ana-rata').innerText = (skor.reduce((a, b) => a + b, 0) / skor.length).toFixed(1);
        document.getElementById('ana-tinggi').innerText = Math.max(...skor);
        document.getElementById('ana-rendah').innerText = Math.min(...skor);
        renderChart(skor);
    } else {
        document.getElementById('ana-rata').innerText = "-";
        document.getElementById('ana-tinggi').innerText = "-";
        document.getElementById('ana-rendah').innerText = "-";
        if (myChart) myChart.destroy();
    }

    // 2. Butir Soal — hitung kesukaran nyata B dari N (PG only, Essay dikecualikan)
    const { data: dataSoal } = await db.from('bank_soal').select('*').eq('mapel', mapel).order('id', { ascending: true });
    const tbody = document.getElementById('tabel-analisis-soal');
    document.getElementById('ana-total-soal').innerText = `Total: ${dataSoal ? dataSoal.length : 0} Soal`;

    if (dataSoal && dataSoal.length > 0) {
        tbody.innerHTML = '';

        // Hitung N = jumlah peserta yang mengerjakan mapel ini (filter kelas jika dipilih)
        // Pakai dataNilai yang sudah terfilter kelas di atas, tapi pastikan hanya yang punya jawaban_pg
        let totalPeserta = 0;
        let pesertaRows = [];
        if (dataNilai && dataNilai.length > 0) {
            pesertaRows = dataNilai.filter(r => r.jawaban_pg && String(r.jawaban_pg).trim() !== '');
            // fallback: jika semua jawaban_pg kosong (data lama), pakai semua baris
            if (pesertaRows.length === 0) pesertaRows = dataNilai;
            totalPeserta = pesertaRows.length;
        }

        // Map soalId -> jumlah benar
        const benarMap = new Map();
        if (totalPeserta > 0 && pesertaRows.length > 0) {
            pesertaRows.forEach(row => {
                let arr = [];
                try {
                    const raw = row.jawaban_pg;
                    if (typeof raw === 'string') arr = JSON.parse(raw);
                    else if (Array.isArray(raw)) arr = raw;
                    else if (raw && typeof raw === 'object') arr = raw;
                } catch(e) { arr = []; }
                if (!Array.isArray(arr)) return;
                arr.forEach(item => {
                    const id = item && (item.id ?? item.id_soal ?? item.soal_id);
                    if (id == null) return;
                    const jwb = item.jawaban != null ? String(item.jawaban).trim().toUpperCase() : '';
                    const kunci = item.kunci != null ? String(item.kunci).trim().toUpperCase() : '';
                    // jika kunci kosong, tidak bisa nilai (skip)
                    if (!kunci) return;
                    if (jwb === kunci) {
                        benarMap.set(String(id), (benarMap.get(String(id)) || 0) + 1);
                    } else {
                        // pastikan key ada dengan 0 jika belum
                        if (!benarMap.has(String(id))) benarMap.set(String(id), benarMap.get(String(id)) || 0);
                    }
                });
            });
        }
        // simpan untuk modal detail per soal
        _anaLastSoal = dataSoal;
        _anaLastPeserta = pesertaRows;
        _anaLastBenarMap = benarMap;
        _anaLastTotal = totalPeserta;
        _anaLastMapel = mapel;

        dataSoal.forEach((s, i) => {
            const isEssay = String(s.tipe_soal||'').toUpperCase() === 'ESSAY';
            let pct = 0, benar = 0, N = totalPeserta;
            let badgeColor = '#64748b', status = '—';
            let label = '—';
            let barPct = 0;

            if (isEssay) {
                // Essay dikecualikan dari kesukaran
                badgeColor = '#64748b';
                status = '—';
                label = '<span style="color:var(--text-muted);">Essay</span>';
                barPct = 0;
            } else {
                benar = benarMap.get(String(s.id)) || 0;
                // N tetap totalPeserta, meskipun ada soal yang tidak dijawab (dianggap salah)
                if (N > 0) pct = (benar / N) * 100;
                else pct = 0;
                barPct = Math.round(pct);

                // Klasifikasi: <30 Sulit, 30-75 Sedang (inclusive), >75 Mudah
                if (pct < 30) { badgeColor = '#ef4444'; status = 'Sulit'; }
                else if (pct <= 75) { badgeColor = '#f59e0b'; status = 'Sedang'; }
                else { badgeColor = '#10b981'; status = 'Mudah'; }

                if (N > 0) label = `<span style="font-size:11px;color:var(--text-main);font-weight:600;">${benar} dari ${N} siswa</span>`;
                else label = `<span style="font-size:11px;color:var(--text-muted);">0 dari 0 siswa</span>`;
            }

            const escPert = String(s.pertanyaan||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');
            const clickable = isEssay ? '' : `onclick="bukaDetailAnalisisSoal('${s.id}')" style="cursor:pointer;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'" title="Klik untuk lihat jawaban siswa"`;
            tbody.innerHTML += `
                <tr ${clickable} style="border-bottom:1px solid var(--border); transition:background 0.15s; ${isEssay?'':'cursor:pointer;'}">
                    <td style="padding:12px;text-align:center;font-weight:600;">${i + 1}</td>
                    <td style="padding:12px;font-size:13px;color:var(--text-main);">
                        <div style="line-height:1.5;">${s.pertanyaan}</div>
                        ${isEssay ? '' : '<div style="font-size:10px;color:var(--text-muted);margin-top:6px;"><i class="fas fa-users" style="margin-right:4px;"></i>Klik untuk lihat jawaban siswa</div>'}
                    </td>
                    <td style="padding:12px;text-align:center;"><span class="badge" style="background:rgba(99,102,241,0.1);color:#a5b4fc;border:1px solid rgba(99,102,241,0.2);">${s.tipe_soal || 'PG'}</span></td>
                    <td style="padding:12px;text-align:center;">
                        <div style="width:100%;background:rgba(255,255,255,0.05);height:8px;border-radius:4px;overflow:hidden;margin-bottom:6px;">
                            <div style="width:${barPct}%;background:${badgeColor};height:100%;transition:width 0.3s;"></div>
                        </div>
                        ${label}
                    </td>
                    <td style="padding:12px;text-align:center;"><span style="font-size:11px;font-weight:700;color:${badgeColor}">${status}</span></td>
                </tr>
            `;
        });

        if (window.MathJax) MathJax.typesetPromise([tbody]).catch(err => console.log('MathJax error:', err));
    } else {
        tbody.innerHTML = '<tr><td colspan="5" style="padding:30px;text-align:center;">Belum ada soal untuk mapel ini.</td></tr>';
    }
}

async function renderChart(skorArray) {
    // Lazy-load Chart.js
    if (typeof Chart === 'undefined') {
        try { await loadScript('https://cdn.jsdelivr.net/npm/chart.js'); } catch (e) { console.error('❌ Gagal memuat Chart.js:', e); return; }
    }

    const ctx = document.getElementById('chartAnalisis').getContext('2d');
    const dist = [0, 0, 0, 0, 0];
    skorArray.forEach(s => {
        if (s <= 20) dist[0]++;
        else if (s <= 40) dist[1]++;
        else if (s <= 60) dist[2]++;
        else if (s <= 80) dist[3]++;
        else dist[4]++;
    });

    if (myChart) myChart.destroy();
    myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['0-20', '21-40', '41-60', '61-80', '81-100'],
            datasets: [{
                label: 'Siswa',
                data: dist,
                backgroundColor: ['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#6366f1'],
                borderRadius: 5
            }]
        },
        options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } }
        }
    });
}

function renderDistribusi() {
    // Chart rendering is handled in renderChart; this is an alias
}

function renderTingkatKesulitan() {
    // Chart rendering is handled in renderChart; this is an alias
}

// ===== Modal Detail Jawaban per Siswa =====
function _ensureAnalisisDetailModal(){
    if(document.getElementById('modal-analisis-detail')) return;
    const modal=document.createElement('div');
    modal.id='modal-analisis-detail';
    modal.style.cssText='display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:9999;align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML=`
    <div style="background:rgba(15,23,42,0.97);border:1px solid rgba(255,255,255,0.08);border-radius:20px;max-width:680px;width:100%;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,0.5);">
      <div style="padding:18px 20px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:#94a3b8;text-transform:uppercase;" id="ana-detail-no">SOAL #1</div>
          <div id="ana-detail-pertanyaan" style="font-size:13px;color:#e2e8f0;margin-top:6px;line-height:1.6;max-height:110px;overflow-y:auto;white-space:normal;word-break:break-word;"></div>
          <div id="ana-detail-meta" style="font-size:11px;color:#64748b;margin-top:8px;"></div>
        </div>
        <button onclick="tutupDetailAnalisisSoal()" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#cbd5e1;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;"><i class="fas fa-times"></i></button>
      </div>
      <div id="ana-detail-list" style="flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:8px; min-height:120px;"></div>
      <div style="padding:12px 16px;border-top:1px solid rgba(255,255,255,0.06);display:flex;justify-content:flex-end;">
        <button onclick="tutupDetailAnalisisSoal()" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;">Tutup</button>
      </div>
    </div>`;
    modal.addEventListener('click', (e)=>{ if(e.target===modal) tutupDetailAnalisisSoal(); });
    document.body.appendChild(modal);
}

function bukaDetailAnalisisSoal(soalId){
    _ensureAnalisisDetailModal();
    const modal=document.getElementById('modal-analisis-detail');
    const soal=_anaLastSoal.find(s=> String(s.id)===String(soalId));
    if(!soal){ showToast('Soal tidak ditemukan','error'); return; }
    const idx=_anaLastSoal.findIndex(s=> String(s.id)===String(soalId));
    const benar=_anaLastBenarMap.get(String(soalId))||0;
    const N=_anaLastTotal||0;
    const pct=N? Math.round(benar/N*100):0;
    let status='—', badgeColor='#64748b';
    if(pct<30){ badgeColor='#ef4444'; status='Sulit'; }
    else if(pct<=75){ badgeColor='#f59e0b'; status='Sedang'; }
    else { badgeColor='#10b981'; status='Mudah'; }
    document.getElementById('ana-detail-no').textContent=`SOAL #${idx+1} • ${soal.tipe_soal||'PG'} • ${status}`;
    document.getElementById('ana-detail-no').style.color=badgeColor;
    document.getElementById('ana-detail-pertanyaan').innerHTML=soal.pertanyaan||'';
    document.getElementById('ana-detail-meta').innerHTML=`<span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;"><span style="width:60px;height:6px;background:rgba(255,255,255,0.08);border-radius:99px;overflow:hidden;display:inline-block;vertical-align:middle;"><span style="display:block;height:100%;width:${pct}%;background:${badgeColor};"></span></span> <b style="color:#e2e8f0;">${benar} dari ${N} siswa</b> menjawab benar (${pct}%) • Kunci: <b style="color:#34d399;">${soal.kunci_jawaban||'-'}</b></span>`;
    const listEl=document.getElementById('ana-detail-list');
    listEl.innerHTML='<div style="text-align:center;padding:20px;color:#64748b;font-size:12px;"><i class="fas fa-spinner fa-spin"></i> Memuat jawaban siswa...</div>';
    const opsiCounts={A:0,B:0,C:0,D:0,E:0,'-':0};
    const siswaList=[];
    _anaLastPeserta.forEach(row=>{
        let arr=[];
        try{
            const raw=row.jawaban_pg;
            if(typeof raw==='string') arr=JSON.parse(raw);
            else if(Array.isArray(raw)) arr=raw;
            else if(raw && typeof raw==='object') arr=raw;
        }catch(e){ arr=[]; }
        const item=arr.find(it=> String(it.id)===String(soalId));
        let jwb=item? String(item.jawaban||'').trim().toUpperCase() : '';
        if(!jwb) jwb='-';
        if(jwb.length>1) jwb=jwb.charAt(0);
        if(!['A','B','C','D','E'].includes(jwb)) jwb='-';
        const kunci=String(soal.kunci_jawaban||'').trim().toUpperCase();
        const isBenar=jwb===kunci && jwb!=='-';
        const keterangan=jwb==='-'?'Tidak menjawab': isBenar?'Benar':'Salah';
        const color=isBenar?'#10b981': jwb==='-'?'#64748b':'#ef4444';
        const bg=isBenar?'rgba(16,185,129,0.12)': jwb==='-'?'rgba(100,116,139,0.08)':'rgba(239,68,68,0.1)';
        const border=isBenar?'rgba(16,185,129,0.2)': jwb==='-'?'rgba(100,116,139,0.15)':'rgba(239,68,68,0.2)';
        opsiCounts[jwb]=(opsiCounts[jwb]||0)+1;
        siswaList.push({nama:row.nama||'-', kelas:row.kelas||'-', jwb, isBenar, keterangan, color, bg, border, skor:row.skor_pg});
    });
    if(siswaList.length===0){
        listEl.innerHTML='<div style="text-align:center;padding:30px;color:#64748b;font-size:13px;">Belum ada siswa yang mengerjakan soal ini.</div>';
    } else {
        siswaList.sort((a,b)=> (b.isBenar - a.isBenar) || a.nama.localeCompare(b.nama,'id'));
        const total=siswaList.length;
        const opsiOrder=['A','B','C','D','E','-'];
        const distribHtml=`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;padding:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;">
          ${opsiOrder.map(o=>{
            const cnt=opsiCounts[o]||0;
            const p=total? Math.round(cnt/total*100):0;
            const isKunci=o===String(soal.kunci_jawaban||'').trim().toUpperCase();
            return `<div style="flex:1;min-width:60px;text-align:center;padding:6px 4px;background:${isKunci?'rgba(16,185,129,0.08)':'rgba(255,255,255,0.02)'};border:1px solid ${isKunci?'rgba(16,185,129,0.2)':'rgba(255,255,255,0.06)'};border-radius:8px;">
              <div style="font-size:14px;font-weight:800;color:${isKunci?'#34d399':'#e2e8f0'};">${o}${isKunci?' ✓':''}</div>
              <div style="font-size:11px;color:#94a3b8;">${cnt} siswa</div>
              <div style="font-size:10px;color:#64748b;">${p}%</div>
            </div>`;
          }).join('')}
        </div>`;
        const rowsHtml=siswaList.map(s=>{
            return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${s.bg};border:1px solid ${s.border};border-radius:12px;">
            <div style="width:32px;height:32px;border-radius:50%;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.2);display:flex;align-items:center;justify-content:center;color:#93c5fd;font-size:12px;font-weight:700;flex-shrink:0;">${(s.nama||'?').charAt(0).toUpperCase()}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;color:#f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.nama}</div>
              <div style="font-size:11px;color:#94a3b8;">${s.kelas} • Skor PG: ${s.skor ?? '-'}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div style="display:inline-flex;align-items:center;justify-content:center;min-width:36px;height:28px;padding:0 8px;border-radius:8px;background:${s.isBenar?'rgba(16,185,129,0.15)': s.jwb==='-'?'rgba(100,116,139,0.15)':'rgba(239,68,68,0.15)'};border:1px solid ${s.isBenar?'rgba(16,185,129,0.3)':'rgba(239,68,68,0.25)'};color:${s.color};font-weight:800;font-size:13px;">${s.jwb}</div>
              <div style="font-size:10px;font-weight:700;color:${s.color};margin-top:2px;text-align:center;">${s.keterangan}</div>
            </div>
          </div>`;
        }).join('');
        listEl.innerHTML=distribHtml+rowsHtml;
    }
    modal.style.display='flex';
    if(window.MathJax) MathJax.typesetPromise([document.getElementById('ana-detail-pertanyaan')]).catch(()=>{});
    document.body.style.overflow='hidden';
}

function tutupDetailAnalisisSoal(){
    const modal=document.getElementById('modal-analisis-detail');
    if(modal) modal.style.display='none';
    document.body.style.overflow='';
}
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ const m=document.getElementById('modal-analisis-detail'); if(m && m.style.display!=='none') tutupDetailAnalisisSoal(); }});

function analisisSoal() {
    bukaHalaman('analisis-soal-page', document.querySelector('[onclick*="analisis-soal-page"]'));
}
