// @ts-nocheck
// ============================================================
// admin-jadwal.js — Jadwal Ujian Section (multi-kelas klik-toggle)
// Format kelas: "X AKL A, X AKL B" (tanpa jurusan)
// Klik per kelas, tanpa Ctrl
// FIX: mulaiEditJadwal sekarang auto-fill mapel + sync custom select
// ============================================================

var editingJadwalId = typeof editingJadwalId !== 'undefined' ? editingJadwalId : null;
var _jadwalLastData = typeof _jadwalLastData !== 'undefined' ? _jadwalLastData : [];
var _jadwalSortBy = typeof _jadwalSortBy !== 'undefined' ? _jadwalSortBy : '';
var _jadwalMapelCache = typeof _jadwalMapelCache !== 'undefined' ? _jadwalMapelCache : [];
async function populateJadwalMapelDropdown() {
    const select = document.getElementById('jadwal-mapel');
    const searchInput = document.getElementById('jadwal-mapel-search');
    const dropdown = document.getElementById('jadwal-mapel-dropdown');
    const selectedEl = document.getElementById('jadwal-mapel-selected');
    if (!select) return;
    const previousValue = (select.value || '').trim();
    const _jmSesi = getGuruSession();
    const _jmIsAdmin = _jmSesi && _jmSesi.isAdmin === true;
    const _jmGuruId = _jmSesi ? _jmSesi.id : null;

    let query = db.from('bank_soal').select('mapel');
    if (!_jmIsAdmin && _jmGuruId) query = query.eq('created_by', _jmGuruId);
    const { data, error } = await query;
    if (error || !data) return;
    const mapelSet = new Set();
    data.forEach(d => { if (d.mapel) mapelSet.add(d.mapel.trim()); });
    _jadwalMapelCache = [...mapelSet].sort((a,b)=>a.localeCompare(b,'id'));
    select.innerHTML = '<option value="">— Pilih Mapel dari Bank Soal —</option>';
    _jadwalMapelCache.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        select.appendChild(opt);
    });
    // restore previous selection (penting saat edit: jangan hilangkan mapel yang sedang di-edit)
    if (previousValue) {
        let exists = [...select.options].some(o => o.value === previousValue);
        if (!exists) {
            const opt = document.createElement('option');
            opt.value = previousValue;
            opt.textContent = previousValue;
            select.appendChild(opt);
            if(!_jadwalMapelCache.includes(previousValue)) _jadwalMapelCache.push(previousValue);
        }
        select.value = previousValue;
        if(searchInput) searchInput.value = previousValue;
        if(selectedEl) selectedEl.innerHTML = previousValue ? `Terpilih: <b style="color:#60a5fa;">${previousValue}</b>` : '';
    } else {
        if(searchInput && !searchInput.dataset.userTyped) searchInput.value = '';
        if(selectedEl && !previousValue) selectedEl.innerHTML = '';
    }
    // Hapus total custom select lama (csl) untuk select hidden — jangan pernah bikin duplikat
    try{
        // Hapus container csl yang terlanjur dibuat untuk #jadwal-mapel
        const cslBtn = document.querySelector('#jadwal-mapel + .csl-container, .csl-container:has(#jadwal-mapel)');
        // Fallback: cari semua csl yang wrap #jadwal-mapel
        document.querySelectorAll('.csl-container').forEach(c=>{
            if(c.contains(select)){
                const b=c.querySelector('.csl-btn'); if(b) b.remove();
                const d=c.querySelector('.csl-dropdown'); if(d && d.id!=='jadwal-mapel-dropdown') d.remove();
                // jika container hanya berisi select hidden, hapus container-nya juga
                if(c.children.length===1 && c.contains(select)){
                    const par=c.parentNode;
                    if(par){ par.insertBefore(select, c); c.remove(); }
                } else {
                    // kalau masih ada, hide saja
                    c.style.display='none';
                }
                delete select.dataset.cslReady;
            }
        });
        // Pastikan select tetap hidden dan tidak punya cslReady
        select.style.display='none';
        select.classList.remove('csl-native');
        delete select.dataset.cslReady;
        // Hapus juga dropdown lama csl untuk jadwal-mapel jika ada (bukan yang baru)
        document.querySelectorAll('#jadwal-mapel-csldd').forEach(el=> el.remove());
    }catch(e){}
    // setup searchable dropdown — list hanya muncul saat ngetik, tidak langsung tampil semua
    if(searchInput && dropdown){
        if(!searchInput.dataset.jadwalSearchReady){
            searchInput.dataset.jadwalSearchReady='1';
            searchInput.addEventListener('input', ()=>{ searchInput.dataset.userTyped='1'; renderJadwalMapelDropdown(searchInput.value); dropdown.style.display='block'; });
            searchInput.addEventListener('focus', ()=>{
                const v=(searchInput.value||'').trim();
                if(v) renderJadwalMapelDropdown(v);
                else {
                    dropdown.innerHTML='<div style="padding:10px; text-align:center; color:#64748b; font-size:12px;">Ketik untuk cari mapel...</div>';
                    dropdown.style.display='block';
                }
            });
            searchInput.addEventListener('blur', ()=> setTimeout(()=>{
                dropdown.style.display='none';
                // sync hidden select dengan ketikan (jika cocok dengan mapel yang ada)
                const typed=(searchInput.value||'').trim();
                const select2=document.getElementById('jadwal-mapel');
                const selectedEl2=document.getElementById('jadwal-mapel-selected');
                if(!typed){ if(select2) select2.value=''; if(selectedEl2) selectedEl2.innerHTML=''; return; }
                const exact=_jadwalMapelCache.find(m=> m.toLowerCase()===typed.toLowerCase());
                if(exact){
                    selectJadwalMapel(exact);
                } else {
                    // jika tidak cocok persis, biarkan value kosong biar validasi gagal (harus pilih dari daftar)
                    const hasExact=_jadwalMapelCache.some(m=> m.toLowerCase()===typed.toLowerCase());
                    if(!hasExact && select2) select2.value='';
                }
            }, 180));
            searchInput.addEventListener('keydown', (e)=>{
                if(e.key==='Enter'){
                    e.preventDefault();
                    const typed=(searchInput.value||'').trim().toLowerCase();
                    const first=_jadwalMapelCache.find(m=> m.toLowerCase().includes(typed));
                    if(first) selectJadwalMapel(first);
                } else if(e.key==='Escape'){ dropdown.style.display='none'; searchInput.blur(); }
            });
            // klik di luar tutup
            document.addEventListener('click', (e)=>{
                if(!searchInput.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display='none';
            });
        }
        // awalnya hidden, hanya muncul saat user ketik/focus dengan isi
        dropdown.style.display='none';
    }
}
function renderJadwalMapelDropdown(filter){
    const dropdown=document.getElementById('jadwal-mapel-dropdown');
    if(!dropdown) return;
    const q=(filter||'').trim().toLowerCase();
    if(!q){
        dropdown.innerHTML='<div style="padding:10px; text-align:center; color:#64748b; font-size:12px;">Ketik untuk cari mapel...</div>';
        dropdown.style.display='block';
        return;
    }
    const list = _jadwalMapelCache.filter(m=> m.toLowerCase().includes(q));
    if(!list.length){
        dropdown.innerHTML='<div style="padding:10px; text-align:center; color:#64748b; font-size:12px;">Tidak ada mapel cocok</div>';
        dropdown.style.display='block';
        return;
    }
    dropdown.innerHTML = list.map(m=> `<div class="csl-option" style="padding:8px 12px; cursor:pointer; border-radius:6px;" onmousedown="event.preventDefault(); selectJadwalMapel('${m.replace(/'/g,"\\'")}')">${m}</div>`).join('');
    dropdown.style.display='block';
}
function selectJadwalMapel(val){
    const select=document.getElementById('jadwal-mapel');
    const searchInput=document.getElementById('jadwal-mapel-search');
    const dropdown=document.getElementById('jadwal-mapel-dropdown');
    const selectedEl=document.getElementById('jadwal-mapel-selected');
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
    if(selectedEl) selectedEl.innerHTML = `Terpilih: <b style="color:#60a5fa;">${val}</b>`;
    if(dropdown) dropdown.style.display='none';
}
function clearJadwalMapelSearch(){
    const select=document.getElementById('jadwal-mapel');
    const searchInput=document.getElementById('jadwal-mapel-search');
    const dropdown=document.getElementById('jadwal-mapel-dropdown');
    const selectedEl=document.getElementById('jadwal-mapel-selected');
    if(select) select.value='';
    if(searchInput) searchInput.value='';
    if(selectedEl) selectedEl.innerHTML='';
    if(dropdown) dropdown.style.display='none';
}

async function populateJadwalKelasOptions() {
    const list = document.getElementById('jadwal-kelas-list');
    const sel = document.getElementById('jadwal-kelas-select');
    if (!list || !sel) return;
    const prevVals = new Set([...sel.selectedOptions].map(o => o.value));
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px;"><i class="fas fa-spinner fa-spin"></i> Memuat kelas...</div>';
    const { data, error } = await db.from('kelas').select('nama').eq('is_aktif', true).order('nama', { ascending: true });
    if (error || !data) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:#f87171;font-size:12px;">Gagal memuat kelas</div>';
        return;
    }
    if (data.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px;">Belum ada kelas — buat di Data Kelas & Siswa</div>';
        sel.innerHTML = '';
        return;
    }
    sel.innerHTML = '';
    data.forEach(k => {
        const opt = document.createElement('option');
        opt.value = k.nama;
        opt.textContent = k.nama;
        if (prevVals.has(k.nama)) opt.selected = true;
        sel.appendChild(opt);
    });
    renderJadwalKelasList();
    renderJadwalKelasChips();
}

function renderJadwalKelasList() {
    const list = document.getElementById('jadwal-kelas-list');
    const sel = document.getElementById('jadwal-kelas-select');
    if (!list || !sel) return;
    const selected = new Set([...sel.selectedOptions].map(o => o.value));
    const all = [...sel.options].map(o => o.value);
    if (all.length === 0) return;
    list.innerHTML = all.map(nama => {
        const active = selected.has(nama);
        return `<button type="button" onclick="toggleJadwalKelas('${nama.replace(/'/g, "\\'")}')" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 10px;border-radius:8px;border:1px solid ${active ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.06)'};background:${active ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.02)'};color:${active ? '#93c5fd' : 'var(--text-main)'};font-size:13px;font-weight:${active ? '700' : '500'};cursor:pointer;transition:all 0.15s;">
            <span style="width:18px;height:18px;border-radius:4px;border:1px solid ${active ? '#60a5fa' : 'rgba(255,255,255,0.15)'};background:${active ? '#3b82f6' : 'transparent'};display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:10px;color:white;">${active ? '✓' : ''}</span>
            <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${nama}</span>
        </button>`;
    }).join('');
}

function toggleJadwalKelas(nama) {
    const sel = document.getElementById('jadwal-kelas-select');
    if (!sel) return;
    const opt = [...sel.options].find(o => o.value === nama);
    if (!opt) return;
    opt.selected = !opt.selected;
    renderJadwalKelasList();
    renderJadwalKelasChips();
}

function renderJadwalKelasChips() {
    const sel = document.getElementById('jadwal-kelas-select');
    const wrap = document.getElementById('jadwal-kelas-chips');
    if (!sel || !wrap) return;
    const vals = [...sel.selectedOptions].map(o => o.value);
    if (vals.length === 0) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = vals.map(v => `<span style="display:inline-flex;align-items:center;gap:6px;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.25);color:#93c5fd;border-radius:20px;padding:4px 10px;font-size:12px;font-weight:600;">${v} <button type="button" onclick="removeJadwalKelasChip('${v.replace(/'/g, "\\'")}')" style="background:rgba(255,255,255,0.08);border:none;color:#93c5fd;width:16px;height:16px;border-radius:50%;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:10px;">×</button></span>`).join('');
}

function removeJadwalKelasChip(val) {
    const sel = document.getElementById('jadwal-kelas-select');
    if (!sel) return;
    const opt = [...sel.options].find(o => o.value === val);
    if (opt) opt.selected = false;
    renderJadwalKelasList();
    renderJadwalKelasChips();
}

function getJadwalKelasFinal() {
    const sel = document.getElementById('jadwal-kelas-select');
    if (!sel) return null;
    const vals = [...sel.selectedOptions].map(o => o.value.trim()).filter(Boolean);
    if (vals.length === 0) return null;
    return vals.join(', ');
}

function setJadwalKelasFromString(kelasStr) {
    const sel = document.getElementById('jadwal-kelas-select');
    if (!sel) return;
    [...sel.options].forEach(o => o.selected = false);
    if (!kelasStr) { renderJadwalKelasList(); renderJadwalKelasChips(); return; }
    let list = [];
    if (kelasStr.includes('::')) {
        const parts = kelasStr.split('::');
        list = parts[1].split(',').map(s => s.trim()).filter(Boolean);
    } else {
        list = kelasStr.split(',').map(s => s.trim()).filter(Boolean);
    }
    [...sel.options].forEach(o => { if (list.includes(o.value)) o.selected = true; });
    renderJadwalKelasList();
    renderJadwalKelasChips();
}

function toLocalISOString(datetimeLocalValue) {
    if (!datetimeLocalValue) return null;
    const d = new Date(datetimeLocalValue);
    if (isNaN(d.getTime())) return null;
    const pad = n => String(n).padStart(2, '0');
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const absOff = Math.abs(off);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(Math.floor(absOff / 60))}:${pad(absOff % 60)}`;
}

function _syncJadwalMapelCustom() {
    const sel = document.getElementById('jadwal-mapel');
    if (!sel) return;
    try {
        if (sel.dataset.cslReady && typeof syncCustomSelect === 'function') syncCustomSelect('jadwal-mapel');
        else if (typeof initCustomSelect === 'function' && !sel.dataset.cslReady) initCustomSelect('jadwal-mapel');
        if (typeof syncCustomSelect === 'function') syncCustomSelect('jadwal-mapel');
    } catch(e){}
}

function _resetJadwalFormUI() {
    const selMapel = document.getElementById('jadwal-mapel');
    const searchInput = document.getElementById('jadwal-mapel-search');
    const dropdown = document.getElementById('jadwal-mapel-dropdown');
    const selectedEl = document.getElementById('jadwal-mapel-selected');
    if (selMapel) {
        selMapel.value = '';
        _syncJadwalMapelCustom();
        selMapel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if(searchInput){ searchInput.value=''; searchInput.dataset.userTyped=''; }
    if(dropdown) dropdown.style.display='none';
    if(selectedEl) selectedEl.innerHTML='';
    const sel = document.getElementById('jadwal-kelas-select');
    if (sel) [...sel.options].forEach(o => o.selected = false);
    renderJadwalKelasList();
    renderJadwalKelasChips();
    const elWaktu = document.getElementById('jadwal-waktu');
    const elSelesai = document.getElementById('jadwal-selesai');
    const elDurasi = document.getElementById('jadwal-durasi');
    if (elWaktu) elWaktu.value = '';
    if (elSelesai) elSelesai.value = '';
    if (elDurasi) elDurasi.value = '';
    const statusEl = document.getElementById('status-jadwal');
    if (statusEl) statusEl.innerHTML = '';
}

function batalEditJadwal() {
    editingJadwalId = null;
    _resetJadwalFormUI();
    const btnSubmit = document.getElementById('btn-submit-jadwal');
    if (btnSubmit) {
        btnSubmit.innerHTML = '<i class="fas fa-plus"></i> Simpan Jadwal';
        btnSubmit.onclick = simpanJadwal;
        btnSubmit.disabled = false;
    }
    const panelTitle = document.querySelector('#jadwal .card-panel .panel-title');
    if (panelTitle) panelTitle.innerHTML = 'Buat Jadwal Baru';
    const cancelBtn = document.getElementById('btn-batal-jadwal');
    if (cancelBtn) cancelBtn.style.display = 'none';
    const statusEl = document.getElementById('status-jadwal');
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">Mode edit dibatalkan</span>';
    if(typeof showToast==='function') showToast('Mode edit dibatalkan','info');
    setTimeout(() => { if (statusEl) statusEl.innerHTML = ''; }, 2000);
}

async function simpanJadwal() {
    const mapel = document.getElementById('jadwal-mapel').value.trim();
    const elWM=document.getElementById('jadwal-waktu');
    const elWS=document.getElementById('jadwal-selesai');
    const waktuMulaiRaw = (elWM && elWM.dataset && elWM.dataset.iso) ? elWM.dataset.iso : (elWM ? elWM.value : '');
    const waktuSelesaiRaw = (elWS && elWS.dataset && elWS.dataset.iso) ? elWS.dataset.iso : (elWS ? elWS.value : '');
    const durasiInput = parseInt(document.getElementById('jadwal-durasi').value);
    const statusEl = document.getElementById('status-jadwal');

    if (!mapel) {
        const msg='Nama mata pelajaran wajib dipilih!';
        statusEl.innerHTML = `<span style="color:#fca5a5;"><i class="fas fa-exclamation-circle"></i> ${msg}</span>`;
        if(typeof showToast==='function') showToast(msg,'error');
        return;
    }
    if (!waktuMulaiRaw || !waktuSelesaiRaw) {
        const msg='Window waktu mulai dan selesai wajib diisi!';
        statusEl.innerHTML = `<span style="color:#fca5a5;"><i class="fas fa-exclamation-circle"></i> ${msg}</span>`;
        if(typeof showToast==='function') showToast(msg,'error');
        return;
    }
    if (new Date(waktuSelesaiRaw) <= new Date(waktuMulaiRaw)) {
        const msg='Batas masuk harus lebih besar dari mulai masuk!';
        statusEl.innerHTML = `<span style="color:#fca5a5;"><i class="fas fa-exclamation-circle"></i> ${msg}</span>`;
        if(typeof showToast==='function') showToast(msg,'error');
        return;
    }
    if (!durasiInput || durasiInput < 1) {
        const msg='Durasi ujian wajib diisi (minimal 1 menit)!';
        statusEl.innerHTML = `<span style="color:#fca5a5;"><i class="fas fa-exclamation-circle"></i> ${msg}</span>`;
        if(typeof showToast==='function') showToast(msg,'error');
        return;
    }

    const waktuMulai = toLocalISOString(waktuMulaiRaw);
    const waktuSelesai = toLocalISOString(waktuSelesaiRaw);
    statusEl.innerHTML = '';

    const kelasFinal = getJadwalKelasFinal();

    const { error } = await adminDb.insert('jadwal_ujian', [{
        mapel, kelas: kelasFinal,
        waktu_mulai: waktuMulai, waktu_selesai: waktuSelesai,
        durasi_menit: durasiInput, is_aktif: true
    }]);
    if (error) {
        const msg='Gagal menyimpan jadwal: '+error.message;
        statusEl.innerHTML = `<span style="color:#fca5a5;"><i class="fas fa-times-circle"></i> ${msg}</span>`;
        if(typeof showToast==='function') showToast(msg,'error');
        return;
    }

    const successMsg=`Jadwal "${mapel}" — ${durasiInput} menit/siswa berhasil disimpan!`;
    statusEl.innerHTML = `<span style="color:#10b981;"><i class="fas fa-check-circle"></i> ${successMsg}</span>`;
    if(typeof showToast==='function') showToast(successMsg,'success');
    _resetJadwalFormUI();
    // pastikan tombol kembali ke mode simpan
    const _btnSimpan=document.getElementById('btn-submit-jadwal');
    if (_btnSimpan) { _btnSimpan.innerHTML = '<i class="fas fa-plus"></i> Simpan Jadwal'; _btnSimpan.onclick = simpanJadwal; }
    const cancelBtn = document.getElementById('btn-batal-jadwal');
    if (cancelBtn) cancelBtn.style.display = 'none';
    const panelTitle = document.querySelector('#jadwal .card-panel .panel-title');
    if (panelTitle) panelTitle.innerHTML = 'Buat Jadwal Baru';
    loadJadwal();
    scheduleNextAutoDeactivate();
}

function _showJadwalLoading(show){
    const ov=document.getElementById('jadwal-loading');
    if(!ov) return;
    if(show){ ov.style.display='flex'; void ov.offsetWidth; ov.classList.add('show'); }
    else { ov.classList.remove('show'); setTimeout(()=>{ if(!ov.classList.contains('show')) ov.style.display='none'; }, 180); }
}
async function loadJadwal() {
    const tbody = document.getElementById('tabel-jadwal');
    const _jSesi = getGuruSession();
    const _jIsAdmin = _jSesi && _jSesi.isAdmin === true;
    const _jGuruId = _jSesi ? _jSesi.id : null;

    if (document.getElementById('jadwal-kelas-list')) populateJadwalKelasOptions();

    const _hasContent = tbody && tbody.children.length>0 && !tbody.innerHTML.includes('Memuat jadwal') && !tbody.innerHTML.includes('Memuat data jadwal') && !tbody.innerHTML.includes('skeleton');
    let _needsOverlay = false;
    if(_hasContent){ _showJadwalLoading(true); _needsOverlay=true; }
    else {
        // Skeleton 3 cards biar tinggi awal sama kayak hasil akhir — tidak lompat kecil→besar
        tbody.innerHTML = `<tr style="display:block; background:transparent; border:none; box-shadow:none; padding:0; margin:0;">
            <td colspan="9" style="display:block; padding:0; border:none; background:transparent;">
                <div class="jadwal-skeleton-grid">
                    <div class="skeleton-card"><div class="skeleton-line" style="width:65%; height:16px;"></div><div class="skeleton-line" style="width:90%;"></div><div class="skeleton-line" style="width:80%;"></div><div class="skeleton-line" style="width:70%; height:10px;"></div></div>
                    <div class="skeleton-card"><div class="skeleton-line" style="width:60%; height:16px;"></div><div class="skeleton-line" style="width:85%;"></div><div class="skeleton-line" style="width:75%;"></div><div class="skeleton-line" style="width:68%; height:10px;"></div></div>
                    <div class="skeleton-card"><div class="skeleton-line" style="width:62%; height:16px;"></div><div class="skeleton-line" style="width:88%;"></div><div class="skeleton-line" style="width:78%;"></div><div class="skeleton-line" style="width:72%; height:10px;"></div></div>
                </div>
            </td></tr>`;
    }

    let _loadData=null, _loadError=null;
    try{
    let query = db.from('jadwal_ujian').select('*, guru:created_by(id, nama)').order('id', { ascending: false });
    if (!_jIsAdmin && _jGuruId) query = query.eq('created_by', _jGuruId);
    const { data, error } = await query;
    _loadData=data; _loadError=error;
    if(_needsOverlay) _showJadwalLoading(false);
    _needsOverlay=false;
    if (error) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:16px; color:red;">Gagal memuat: ${error.message}</td></tr>`;
        return;
    }
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:16px; color:var(--text-muted);">Belum ada jadwal. Silakan buat jadwal baru di sebelah kiri.</td></tr>';
        return;
    }

    // simpan untuk sort tanpa refetch
    _jadwalLastData = [...data];
    let displayData = [...data];
    if(_jadwalSortBy){
        const getT = v=> v? new Date(v).getTime():0;
        const getMod = j=> j.created_at ? getT(j.created_at) : (j.id||0);
        displayData.sort((a,b)=>{
            switch(_jadwalSortBy){
                case 'date-asc': return getT(a.waktu_mulai) - getT(b.waktu_mulai);
                case 'date-desc': return getT(b.waktu_mulai) - getT(a.waktu_mulai);
                case 'mod-desc': return getMod(b) - getMod(a);
                case 'mod-asc': return getMod(a) - getMod(b);
                case 'az': return String(a.mapel||'').localeCompare(String(b.mapel||''),'id');
                case 'za': return String(b.mapel||'').localeCompare(String(a.mapel||''),'id');
                default: return 0;
            }
        });
    }

    tbody.innerHTML = '';
    if (jadwalTimeout) { clearTimeout(jadwalTimeout); jadwalTimeout = null; }

    let nextRefreshTime = Infinity;

    displayData.forEach(j => {
        const isAktif = j.is_aktif === true;
        const checked = isAktif ? 'checked' : '';
        const creatorName = j.guru ? j.guru.nama : (j.created_by ? 'Tidak diketahui' : '<span style="color:var(--text-muted);font-size:11px;">—</span>');

        let kelasLabel = "";
        if (!j.kelas) {
            kelasLabel = `<span class="jk-kelas-empty">Semua kelas</span>`;
        } else if (typeof j.kelas === 'string' && j.kelas.includes('::')) {
            const parts = j.kelas.split('::');
            const listKelas = parts[1].split(',').map(k => k.trim()).filter(Boolean);
            const isMany = listKelas.length > 2;
            const fullTitle = listKelas.join(', ');
            const badges = listKelas.map(k => `<span class="jk-kelas-badge" title="${fullTitle}">${k}</span>`).join('');
            kelasLabel = `<div class="jk-kelas-wrap ${isMany ? 'is-many' : 'is-few'}" title="${fullTitle}">
                <div style="font-size:10px; color:var(--gold-light); font-weight:800; text-transform:uppercase; letter-spacing:0.5px; display:none;">${parts[0]}</div>
                <div class="jk-kelas-badges">${badges}</div>
            </div>`;
        } else {
            const listKelas = j.kelas.split(',').map(k => k.trim()).filter(Boolean);
            const isMany = listKelas.length > 2;
            const fullTitle = listKelas.join(', ');
            const badges = listKelas.map(k => `<span class="jk-kelas-badge" title="${fullTitle}">${k}</span>`).join('');
            kelasLabel = `<div class="jk-kelas-wrap ${isMany ? 'is-many' : 'is-few'}" title="${fullTitle}"><div class="jk-kelas-badges">${badges}</div></div>`;
        }

        const now = new Date();
        const tMulai = j.waktu_mulai ? new Date(j.waktu_mulai) : null;
        let tSelesai = j.waktu_selesai ? new Date(j.waktu_selesai) : null;

        if (!tMulai || isNaN(tMulai.getTime())) {
            tbody.innerHTML += `<tr><td colspan="9" style="color:red; text-align:center;">Data jadwal ID ${j.id} tidak valid (Waktu Mulai kosong)</td></tr>`;
            return;
        }
        if (!tSelesai || isNaN(tSelesai.getTime())) {
            tSelesai = new Date(tMulai.getTime() + (j.durasi_menit || 90) * 60000);
        }

        let statusAuto = '';
        if (!isAktif || now > tSelesai) {
            statusAuto = '<span class="badge" style="background:rgba(148,163,184,0.08); color:#94a3b8; border:1px solid rgba(148,163,184,0.2); white-space:nowrap;"><i class="fas fa-power-off" style="font-size:10px; margin-right:4px;"></i>Nonaktif</span>';
        } else if (now < tMulai) {
            statusAuto = '<span class="badge" style="background:rgba(100,116,139,0.1); color:#94a3b8; border:1px solid rgba(100,116,139,0.2); white-space:nowrap;">⏳ Belum Dimulai</span>';
        } else {
            statusAuto = '<span class="badge" style="background:rgba(16,185,129,0.1); color:#34d399; border:1px solid rgba(16,185,129,0.2); white-space:nowrap; animation:pulse 1.5s infinite;">🟢 Sedang Berjalan</span>';
        }

        const durasiPerSiswa = j.durasi_menit || null;
        const durasiLabel = durasiPerSiswa
            ? `<div class="jk-durasi"><strong>${durasiPerSiswa}</strong><span>menit</span></div>`
            : `<span style="color:#94a3b8; font-size:11px;">—</span>`;

        const displayWaktu = `
            <div class="jk-waktu">
                <div class="jk-waktu-date">${tMulai.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                <div class="jk-waktu-time">
                    <span class="jk-t-start">${tMulai.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span class="jk-t-sep">s/d</span>
                    <span class="jk-t-end">${tSelesai.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
            </div>
        `;

        tbody.innerHTML += `
            <tr>
                <td data-label="" style="text-align:center; vertical-align:top; padding-top:18px;"><input type="checkbox" class="cb-jadwal" value="${j.id}"></td>
                <td data-label="Mapel" style="font-weight:700; color:var(--text-main); text-align:left; padding:14px 16px; vertical-align:top;">
                    <div style="display:flex; align-items:center; gap:12px; width:100%; background:transparent;">
                        <div style="font-weight:700; color:#f1f5f9; font-size:13px; line-height:1.3; flex:1; min-width:0; white-space:normal; word-break:break-word; overflow-wrap:anywhere;">${j.mapel}</div>
                    </div>
                </td>
                <td data-label="Kelas" style="text-align:center; padding:14px 12px;">${kelasLabel}</td>
                <td data-label="Waktu" style="text-align:center; white-space:nowrap;">${displayWaktu}</td>
                <td data-label="Durasi" style="text-align:center;">${durasiLabel}</td>
                <td data-label="Status" style="text-align:center;">${statusAuto}</td>
                <td data-label="Aktif" style="text-align:center;">
                    <div class="jk-aktivasi-wrap">
                        <label class="toggle">
                            <input type="checkbox" ${checked} onchange="toggleAktifJadwal(${j.id}, this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                        <span class="jk-aktivasi-text">${isAktif ? 'AKTIF' : 'NONAKTIF'}</span>
                    </div>
                </td>
                <td data-label="Pembuat" style="text-align:center; font-size:12px; color:var(--text-muted);"><span class="jk-pembuat">${creatorName}</span></td>
                <td data-label="Aksi" style="text-align:center;">
                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                        <button class="btn btn-primary" style="padding:8px 14px; font-size:12px; background:transparent; color:#60a5fa; border:1px solid rgba(59,130,246,.35);" onclick="mulaiEditJadwal(${j.id})" title="Edit Jadwal"><i class="fas fa-edit"></i> <span>Edit</span></button>
                        <button class="btn btn-danger" style="padding:8px 14px; font-size:12px; background:transparent; color:#f87171; border:1px solid rgba(239,68,68,.35);" onclick="hapusJadwal(${j.id}, '${j.mapel.replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i> <span>Hapus</span></button>
                    </div>
                </td>
            </tr>
        `;

        if (tMulai > now && tMulai.getTime() < nextRefreshTime) nextRefreshTime = tMulai.getTime();
        if (tSelesai > now && tSelesai.getTime() < nextRefreshTime) nextRefreshTime = tSelesai.getTime();
    });
    // terapkan filter pencarian yang sedang aktif (jangan hilang setelah reload)
    try{ if(typeof filterJadwal==='function' && document.getElementById('search-jadwal')?.value) filterJadwal(); }catch(e){}

    if (nextRefreshTime !== Infinity) {
        const delayMs = nextRefreshTime - new Date().getTime() + 500;
        if (delayMs < 86400000 && document.getElementById('jadwal').classList.contains('active')) {
            jadwalTimeout = setTimeout(() => { loadJadwal(); }, Math.max(1000, delayMs));
        }
    }
    }catch(_e){ console.warn(_e); _showJadwalLoading(false); }
    finally{ if(_needsOverlay) _showJadwalLoading(false); }
}

async function toggleAktifJadwal(id, isAktif) {
    const { error } = await adminDb.update('jadwal_ujian', id, { is_aktif: isAktif });
    if (error) { showToast('Gagal mengubah status: ' + error.message, 'error'); loadJadwal(); }
    else { showToast(`Jadwal ${isAktif ? 'diaktifkan' : 'dinonaktifkan'}`, 'info'); loadJadwal(); }
}

function toggleJadwalAktif(id, isAktif) { return toggleAktifJadwal(id, isAktif); }

async function hapusJadwal(id, mapel) {
    if (!await asyncConfirm(`Hapus jadwal <b>"${mapel}"</b>?<br>Tindakan ini tidak bisa dibatalkan.`, "Hapus Jadwal?")) return;
    const { data: savedJadwal } = await db.from('jadwal_ujian').select('*').eq('id', id).single();
    const { error } = await adminDb.delete('jadwal_ujian', id);
    if (error) showToast('Gagal menghapus: ' + error.message, 'error');
    else {
        const undoFunc = async () => {
            if (savedJadwal) { await adminDb.insert('jadwal_ujian', [savedJadwal]); loadJadwal(); showToast(`Jadwal "${mapel}" berhasil di-restore`, 'success'); }
        };
        showToast(`Jadwal "${mapel}" berhasil dihapus`, 'success', undoFunc, 'Undo');
        loadJadwal();
        if (editingJadwalId === id) batalEditJadwal();
    }
}

async function mulaiEditJadwal(id) {
    // — Loader instan global saja, tanpa animasi di tombol —
    let _cardEl = null;
    try{
        const _gl=document.getElementById('global-loader');
        const _glTxt=document.getElementById('global-loader-text');
        if(_gl){ _gl.style.display='flex'; void _gl.offsetWidth; _gl.classList.add('show'); _gl.style.opacity='1'; if(_glTxt) _glTxt.textContent='Memuat jadwal...'; }
        const _triggerBtn = (typeof event !== 'undefined' && event?.currentTarget) ? event.currentTarget : document.activeElement;
        _cardEl = _triggerBtn && _triggerBtn.closest ? _triggerBtn.closest('tr') : null;
        if(_cardEl) _cardEl.classList.add('jadwal-pulse');
    }catch(e){}
    let _editData=null, _editError=null;
    try{
    const { data, error } = await db.from('jadwal_ujian').select('*').eq('id', id).single();
    _editData=data; _editError=error;
    if (error || !data) {
        console.error('mulaiEditJadwal fetch error:', error);
        if (typeof showToast === 'function') showToast('Gagal memuat jadwal: ' + (error?.message || error?.details || 'tidak ditemukan') + ' (id:'+id+')', 'error');
        return;
    }

    editingJadwalId = id;

    // 1) Pastikan dropdown Mapel terisi dulu, lalu set value + sync custom select
    try { await populateJadwalMapelDropdown(); } catch(e){}
    const selMapel = document.getElementById('jadwal-mapel');
    const searchInputEdit = document.getElementById('jadwal-mapel-search');
    const selectedElEdit = document.getElementById('jadwal-mapel-selected');
    if (selMapel) {
        const targetMapel = (data.mapel || '').trim();
        if (targetMapel) {
            let exists = [...selMapel.options].some(o => o.value.trim() === targetMapel);
            if (!exists) {
                const opt = document.createElement('option');
                opt.value = targetMapel;
                opt.textContent = targetMapel;
                selMapel.appendChild(opt);
                if(typeof _jadwalMapelCache !== 'undefined' && !_jadwalMapelCache.includes(targetMapel)) _jadwalMapelCache.push(targetMapel);
            }
            selMapel.value = targetMapel;
            if(searchInputEdit){ searchInputEdit.value = targetMapel; searchInputEdit.dataset.userTyped='1'; }
            if(selectedElEdit) selectedElEdit.innerHTML = `Terpilih: <b style="color:#60a5fa;">${targetMapel}</b>`;
            _syncJadwalMapelCustom();
            selMapel.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    // 2) Kelas — harus setelah populate agar opsi ada
    await populateJadwalKelasOptions();
    setJadwalKelasFromString(data.kelas);

    function toLocalDatetimeInput(isoStr) {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return '';
        const pad = n => String(n).padStart(2, '0');
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    function toISOFromDisplayOrInput(el){
        if(!el) return '';
        if(el.dataset && el.dataset.iso) return el.dataset.iso;
        const v=(el.value||'').trim();
        const p=_dtpParseDisplay(v);
        if(p){ const pad=n=>String(n).padStart(2,'0'); return `${p.y}-${pad(p.m+1)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`; }
        return v;
    }

    let selesaiVal = data.waktu_selesai;
    if (!selesaiVal && data.waktu_mulai) {
        const tMulai = new Date(data.waktu_mulai);
        if (!isNaN(tMulai.getTime())) {
            const tSelesai = new Date(tMulai.getTime() + (data.durasi_menit || 90) * 60000);
            selesaiVal = tSelesai.toISOString();
        }
    }

    const elW = document.getElementById('jadwal-waktu');
    const elS = document.getElementById('jadwal-selesai');
    if(elW){ elW.value = toLocalDatetimeInput(data.waktu_mulai); try{ const dW=new Date(data.waktu_mulai); if(!isNaN(dW.getTime())){ const pad=n=>String(n).padStart(2,'0'); elW.dataset.iso=`${dW.getFullYear()}-${pad(dW.getMonth()+1)}-${pad(dW.getDate())}T${pad(dW.getHours())}:${pad(dW.getMinutes())}`; } }catch(e){} }
    if(elS && selesaiVal){ elS.value = toLocalDatetimeInput(selesaiVal); try{ const dS=new Date(selesaiVal); if(!isNaN(dS.getTime())){ const pad=n=>String(n).padStart(2,'0'); elS.dataset.iso=`${dS.getFullYear()}-${pad(dS.getMonth()+1)}-${pad(dS.getDate())}T${pad(dS.getHours())}:${pad(dS.getMinutes())}`; } }catch(e){} }
    document.getElementById('jadwal-durasi').value = data.durasi_menit || '';

    const btnSubmit = document.getElementById('btn-submit-jadwal');
    if (btnSubmit) {
        btnSubmit.innerHTML = '<i class="fas fa-save"></i> Update Jadwal';
        btnSubmit.onclick = updateJadwal;
        btnSubmit.disabled = false;
    }

    // UI: ubah judul panel + tombol batal
    const panelTitle = document.querySelector('#jadwal .card-panel .panel-title');
    if (panelTitle) panelTitle.innerHTML = '<i class="fas fa-edit" style="color:#60a5fa;"></i> Edit Jadwal';
    let cancelBtn = document.getElementById('btn-batal-jadwal');
    if (!cancelBtn && btnSubmit && btnSubmit.parentNode) {
        cancelBtn = document.createElement('button');
        cancelBtn.id = 'btn-batal-jadwal';
        cancelBtn.className = 'btn btn-outline';
        cancelBtn.style.cssText = 'width:100%;justify-content:center;margin-top:8px;';
        cancelBtn.innerHTML = '<i class="fas fa-times"></i> Batal Edit';
        cancelBtn.onclick = batalEditJadwal;
        btnSubmit.insertAdjacentElement('afterend', cancelBtn);
    } else if (cancelBtn) {
        cancelBtn.style.display = '';
    }

    const statusEl = document.getElementById('status-jadwal');
    if (statusEl) statusEl.innerHTML = `<span style="color:#93c5fd;font-size:12px;"><i class="fas fa-info-circle"></i> Mengedit "<b>${data.mapel}</b>" — ubah lalu klik Update</span>`;
    if(typeof showToast==='function') showToast('Memuat jadwal "'+data.mapel+'" untuk diedit','info');

    const card = document.querySelector('#jadwal .card-panel');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // fokus ke mapel agar user langsung lihat terisi
    if (selMapel) selMapel.focus();
    }catch(_e){ if(typeof showToast==='function') showToast('Gagal memuat jadwal','error'); }
    finally{
        try{
            const _gl=document.getElementById('global-loader');
            if(_gl){ _gl.classList.remove('show'); setTimeout(()=>{ if(!_gl.classList.contains('show')) _gl.style.display='none'; }, 220); const _glTxt=document.getElementById('global-loader-text'); if(_glTxt) _glTxt.textContent='Memproses...'; }
            if(_cardEl) _cardEl.classList.remove('jadwal-pulse');
        }catch(e){}
    }
}

async function updateJadwal() {
    if (!editingJadwalId) return;
    const mapelEl = document.getElementById('jadwal-mapel');
    const mapel = mapelEl ? mapelEl.value.trim() : '';
    const elMR=document.getElementById('jadwal-waktu');
    const elSR=document.getElementById('jadwal-selesai');
    const mulaiRaw = (elMR && elMR.dataset && elMR.dataset.iso) ? elMR.dataset.iso : (elMR ? elMR.value : '');
    const selesaiRaw = (elSR && elSR.dataset && elSR.dataset.iso) ? elSR.dataset.iso : (elSR ? elSR.value : '');
    const durasiInput = parseInt(document.getElementById('jadwal-durasi').value);

    if (!mapel) return showToast('Mapel wajib dipilih!', 'error');
    if (!mulaiRaw || !selesaiRaw) return showToast('Window waktu wajib diisi!', 'error');
    if (new Date(selesaiRaw) <= new Date(mulaiRaw)) return showToast('Batas masuk harus setelah mulai masuk!', 'error');
    if (!durasiInput || durasiInput < 1) return showToast('Durasi ujian wajib diisi (min 1 menit)!', 'error');

    const mulai = toLocalISOString(mulaiRaw);
    const selesai = toLocalISOString(selesaiRaw);

    const kelasFinal = getJadwalKelasFinal();

    const { error } = await adminDb.update('jadwal_ujian', editingJadwalId, {
        mapel, kelas: kelasFinal, waktu_mulai: mulai, waktu_selesai: selesai, durasi_menit: durasiInput, is_aktif: true
    });

    if (error) {
        return showToast('Gagal update: ' + error.message, 'error');
    }

    showToast(`Jadwal diperbarui! Durasi: ${durasiInput} menit / siswa`, 'success');
    editingJadwalId = null;
    const btnSubmit2=document.getElementById('btn-submit-jadwal');
    if (btnSubmit2) { btnSubmit2.innerHTML = '<i class="fas fa-plus"></i> Simpan Jadwal'; btnSubmit2.onclick = simpanJadwal; }
    const panelTitle = document.querySelector('#jadwal .card-panel .panel-title');
    if (panelTitle) panelTitle.innerHTML = 'Buat Jadwal Baru';
    const cancelBtn = document.getElementById('btn-batal-jadwal');
    if (cancelBtn) cancelBtn.style.display = 'none';
    _resetJadwalFormUI();
    loadJadwal();
    try { if (typeof scheduleNextAutoDeactivate === 'function') scheduleNextAutoDeactivate(); } catch(e){}
}

async function editJadwal(id) { return mulaiEditJadwal(id); }

async function bulkActionJadwal(action) {
    const ids = Array.from(document.querySelectorAll('.cb-jadwal:checked')).map(cb => cb.value);
    if (ids.length === 0) return showToast("Pilih minimal satu jadwal!", 'info');

    if (action === 'delete') {
        const confirmed = await asyncConfirm(`Hapus <b>${ids.length} jadwal</b> terpilih?<br>Tindakan ini tidak bisa dibatalkan.`, "Hapus Jadwal?");
        if (!confirmed) { showToast("Hapus jadwal dibatalkan", 'info'); return; }
        const { data: backupData } = await db.from('jadwal_ujian').select('*').in('id', ids);
        const { error: jBatchErr } = await adminDb.batchDelete('jadwal_ujian', ids);
        if (jBatchErr) { showToast("Gagal menghapus: " + jBatchErr.message, 'error'); return; }
        const undoFunc = async () => {
            if (backupData && backupData.length > 0) { await chunkedInsert('jadwal_ujian', backupData); loadJadwal(); showToast(`${ids.length} jadwal berhasil di-restore`, 'success'); }
        };
        showToast(`${ids.length} jadwal berhasil dihapus`, 'success', undoFunc, 'Undo');
        if (editingJadwalId && ids.includes(String(editingJadwalId))) batalEditJadwal();
    } else {
        const status = (action === 'active');
        for (const jid of ids) { await adminDb.update('jadwal_ujian', jid, { is_aktif: status }); }
        showToast(`${ids.length} jadwal ${status ? 'diaktifkan' : 'dinonaktifkan'}`, 'success');
    }
    loadJadwal();
}

function loadJadwalGuruOptions() {}

// ============================================================
// CUSTOM DATETIME PICKER — Penjadwalan (scrollbar jam selalu terlihat)
// Pengganti picker native yang scrollbar-nya hilang/kepotong.
// Kolom jam & menit dibuat scroll mandiri dengan thumb biru tebal.
// ============================================================
var _dtpActive = typeof _dtpActive !== 'undefined' ? _dtpActive : null;
var _dtpState = typeof _dtpState !== 'undefined' ? _dtpState : { y: 2026, m: 8, d: 16, h: 13, mi: 34 };
var _dtpOverlay = typeof _dtpOverlay !== 'undefined' ? _dtpOverlay : null, _dtpPopup = typeof _dtpPopup !== 'undefined' ? _dtpPopup : null;
var _dtpMPOpen = typeof _dtpMPOpen !== 'undefined' ? _dtpMPOpen : false;
var _dtpMonthNames = typeof _dtpMonthNames !== 'undefined' ? _dtpMonthNames : ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
var _dtpMonthShort = typeof _dtpMonthShort !== 'undefined' ? _dtpMonthShort : ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

function _dtpPad(n){ return String(n).padStart(2,'0'); }
function _dtpToInputVal(s){ return `${s.y}-${_dtpPad(s.m+1)}-${_dtpPad(s.d)}T${_dtpPad(s.h)}:${_dtpPad(s.mi)}`; }
function _dtpFormatDisplay(s){ return `${_dtpPad(s.d)}/${_dtpPad(s.m+1)}/${s.y} ${_dtpPad(s.h)}:${_dtpPad(s.mi)}`; }
function _dtpToISOVal(s){ return `${s.y}-${_dtpPad(s.m+1)}-${_dtpPad(s.d)}T${_dtpPad(s.h)}:${_dtpPad(s.mi)}`; }
function _dtpParseDisplay(v){
    if(!v) return null;
    // dd/mm/yyyy HH:MM  atau  dd-mm-yyyy HH:MM  atau  yyyy-mm-ddTHH:MM
    let m = v.match(/^\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2}):(\d{1,2})/);
    if(m){ return { y:parseInt(m[3]), m:parseInt(m[2])-1, d:parseInt(m[1]), h:parseInt(m[4]), mi:parseInt(m[5]) }; }
    m = v.match(/^\s*(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2}):(\d{1,2})/);
    if(m){ return { y:parseInt(m[1]), m:parseInt(m[2])-1, d:parseInt(m[3]), h:parseInt(m[4]), mi:parseInt(m[5]) }; }
    return null;
}
function _dtpFromInputVal(v){
    if(!v) return null;
    const d = new Date(v);
    if(!isNaN(d.getTime())) return { y:d.getFullYear(), m:d.getMonth(), d:d.getDate(), h:d.getHours(), mi:d.getMinutes() };
    const p = _dtpParseDisplay(v);
    if(p) return p;
    return null;
}
function _dtpDaysInMonth(y,m){ return new Date(y, m+1, 0).getDate(); }
function _dtpEnsureDom(){
    if(_dtpOverlay) return;
    _dtpOverlay = document.createElement('div');
    _dtpOverlay.className = 'dtp-overlay';
    _dtpOverlay.addEventListener('click', closeDTP);
    _dtpPopup = document.createElement('div');
    _dtpPopup.className = 'dtp-popup';
    _dtpPopup.addEventListener('click', e=> e.stopPropagation());
    document.body.appendChild(_dtpOverlay);
    document.body.appendChild(_dtpPopup);
    window.addEventListener('resize', ()=>{ if(_dtpActive) _dtpPosition(); });
    document.addEventListener('keydown', e=>{ if(e.key==='Escape' && _dtpActive) closeDTP(); });
}
function _dtpPosition(){
    if(!_dtpActive || !_dtpPopup) return;
    const r = _dtpActive.getBoundingClientRect();
    const pw = _dtpPopup.offsetWidth, ph = _dtpPopup.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let top = r.bottom + 8, left = r.left;
    // keep inside viewport
    if(left + pw > vw - 12) left = vw - pw - 12;
    if(left < 12) left = 12;
    if(top + ph > vh - 12){
        // try above
        const alt = r.top - ph - 8;
        if(alt >= 12) top = alt;
        else top = Math.max(12, vh - ph - 12);
    }
    if(window.innerWidth <= 640){
        // center modal on mobile
        _dtpPopup.style.left = '50%'; _dtpPopup.style.top = '50%';
        _dtpPopup.style.transform = 'translate(-50%,-50%)';
        _dtpPopup.style.right = 'auto'; _dtpPopup.style.bottom = 'auto';
    } else {
        _dtpPopup.style.left = left + 'px';
        _dtpPopup.style.top = top + 'px';
        _dtpPopup.style.transform = 'none';
    }
}
function openDTP(input){
    _dtpEnsureDom();
    _dtpActive = input;
    _dtpMPOpen = false;
    const parsed = _dtpFromInputVal(input.value);
    const now = new Date();
    if(parsed){ _dtpState = { y:parsed.y, m:parsed.m, d:parsed.d, h:parsed.h, mi:parsed.mi }; }
    else { _dtpState = { y:now.getFullYear(), m:now.getMonth(), d:now.getDate(), h:now.getHours(), mi:now.getMinutes() }; }
    _dtpRender();
    _dtpOverlay.classList.add('show');
    _dtpPopup.style.display = 'flex';
    requestAnimationFrame(()=>{ _dtpPosition(); _dtpScrollToSelected(); });
}
function closeDTP(){
    if(!_dtpOverlay) return;
    _dtpOverlay.classList.remove('show');
    if(_dtpPopup) _dtpPopup.style.display = 'none';
    _dtpMPOpen=false;
    _dtpActive = null;
}
function _dtpSyncInput(){
    if(!_dtpActive) return;
    const iso = _dtpToISOVal(_dtpState);
    const disp = _dtpFormatDisplay(_dtpState);
    _dtpActive.value = disp;
    try{ _dtpActive.dataset.iso = iso; _dtpActive.dataset.display = disp; }catch(e){}
    _dtpActive.dispatchEvent(new Event('change',{bubbles:true}));
    _dtpActive.dispatchEvent(new Event('input',{bubbles:true}));
}
function _dtpScrollToSelected(){
    if(!_dtpPopup) return;
    const hEl = _dtpPopup.querySelector('.dtp-tok.sel[data-h]');
    const miEl = _dtpPopup.querySelector('.dtp-tok.sel[data-mi]');
    const hList = _dtpPopup.querySelector('#dtp-hlist');
    const miList = _dtpPopup.querySelector('#dtp-milist');
    if(hEl && hList){
        const top = hEl.offsetTop - hList.clientHeight/2 + hEl.offsetHeight/2;
        hList.scrollTop = Math.max(0, top);
    }
    if(miEl && miList){
        const top = miEl.offsetTop - miList.clientHeight/2 + miEl.offsetHeight/2;
        miList.scrollTop = Math.max(0, top);
    }
}
function _dtpRender(){
    if(!_dtpPopup) return;
    const y = _dtpState.y, m = _dtpState.m;
    const dim = _dtpDaysInMonth(y,m);
    const firstDay = new Date(y,m,1).getDay(); // 0 Su
    const prevDim = _dtpDaysInMonth(y, m-1 <0?11:m-1);
    // build days array 42 cells
    let daysHtml = '';
    for(let i=0;i<42;i++){
        let dayNum, isOther=false, isPrev=false, cellY=y, cellM=m;
        if(i < firstDay){ dayNum = prevDim - firstDay + 1 + i; isOther=true; isPrev=true; cellM = m-1; if(cellM<0){cellM=11; cellY=y-1;} }
        else if(i >= firstDay+dim){ dayNum = i - firstDay - dim +1; isOther=true; cellM=m+1; if(cellM>11){cellM=0; cellY=y+1;} }
        else { dayNum = i-firstDay+1; }
        const isToday = (cellY===new Date().getFullYear() && cellM===new Date().getMonth() && dayNum===new Date().getDate());
        const isSel = (!isOther && dayNum===_dtpState.d);
        // but selection should follow actual y/m/d; if other month clicked, will navigate
        const cls = ['dtp-day', isOther?'other':'', isToday?'today':'', isSel?'selected':''].filter(Boolean).join(' ');
        daysHtml += `<div class="${cls}" data-day="${dayNum}" data-other="${isOther?1:0}" data-cm="${cellM}" data-cy="${cellY}">${dayNum}</div>`;
    }
    let hHtml='', miHtml='';
    for(let h=0; h<24; h++){
        const sel = h===_dtpState.h?' sel':'';
        hHtml+=`<div class="dtp-tok${sel}" data-h="${h}">${_dtpPad(h)}</div>`;
    }
    for(let mi=0; mi<60; mi++){
        const sel = mi===_dtpState.mi?' sel':'';
        miHtml+=`<div class="dtp-tok${sel}" data-mi="${mi}">${_dtpPad(mi)}</div>`;
    }
    const _mpHtml = (()=>{ let _mps=''; for(let i=0;i<12;i++){ const sel=i===m?' sel':''; _mps+=`<button type="button" class="dtp-mp-mon${sel}" data-mp="${i}">${_dtpMonthShort[i]}</button>`;} return `
        <div class="dtp-month-picker${_dtpMPOpen?' show':''}" id="dtp-mp">
            <div class="dtp-mp-year">
                <button type="button" id="dtp-mp-prevY" aria-label="Tahun sebelumnya"><i class="fas fa-chevron-left"></i></button>
                <span>${y}</span>
                <button type="button" id="dtp-mp-nextY" aria-label="Tahun berikutnya"><i class="fas fa-chevron-right"></i></button>
            </div>
            <div class="dtp-mp-grid">${_mps}</div>
        </div>`; })();
    _dtpPopup.innerHTML = `
        <div class="dtp-cal">
            <div class="dtp-cal-head">
                <button type="button" class="dtp-month-btn${_dtpMPOpen?' open':''}" id="dtp-monthBtn">${_dtpMonthNames[m]} ${y} <i class="fas fa-chevron-down"></i></button>
                <div class="dtp-nav">
                    <button type="button" id="dtp-prev" aria-label="Bulan sebelumnya"><i class="fas fa-arrow-up"></i></button>
                    <button type="button" id="dtp-next" aria-label="Bulan berikutnya"><i class="fas fa-arrow-down"></i></button>
                </div>
            </div>
            ${_mpHtml}
            <div class="dtp-week"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div>
            <div class="dtp-days">${daysHtml}</div>
            <div class="dtp-foot">
                <button type="button" id="dtp-clear">Clear</button>
                <button type="button" id="dtp-today">Today</button>
            </div>
        </div>
        <div class="dtp-time">
            <div class="dtp-time-col">
                <div class="dtp-time-head">Jam</div>
                <div class="dtp-time-list" id="dtp-hlist">${hHtml}</div>
            </div>
            <div class="dtp-time-col">
                <div class="dtp-time-head">Menit</div>
                <div class="dtp-time-list" id="dtp-milist">${miHtml}</div>
            </div>
        </div>
    `;
    // events
    _dtpPopup.querySelector('#dtp-prev').onclick = ()=>{ let nm=m-1, ny=y; if(nm<0){nm=11; ny--;} _dtpState.y=ny; _dtpState.m=nm; _dtpMPOpen=false; _dtpRender(); requestAnimationFrame(_dtpScrollToSelected); };
    _dtpPopup.querySelector('#dtp-next').onclick = ()=>{ let nm=m+1, ny=y; if(nm>11){nm=0; ny++;} _dtpState.y=ny; _dtpState.m=nm; _dtpMPOpen=false; _dtpRender(); requestAnimationFrame(_dtpScrollToSelected); };
    _dtpPopup.querySelector('#dtp-monthBtn').onclick = (e)=>{ e.stopPropagation(); _dtpMPOpen=!_dtpMPOpen; _dtpRender(); requestAnimationFrame(()=>{ _dtpPosition(); _dtpScrollToSelected(); }); };
    const _mpEl = _dtpPopup.querySelector('#dtp-mp');
    if(_mpEl){
        _mpEl.addEventListener('click', e=> e.stopPropagation());
        const _mpPrev = _mpEl.querySelector('#dtp-mp-prevY');
        const _mpNext = _mpEl.querySelector('#dtp-mp-nextY');
        if(_mpPrev) _mpPrev.onclick=(e)=>{ e.stopPropagation(); _dtpState.y=y-1; _dtpRender(); requestAnimationFrame(_dtpScrollToSelected); };
        if(_mpNext) _mpNext.onclick=(e)=>{ e.stopPropagation(); _dtpState.y=y+1; _dtpRender(); requestAnimationFrame(_dtpScrollToSelected); };
        _mpEl.querySelectorAll('.dtp-mp-mon').forEach(btn=>{
            btn.addEventListener('click', (e)=>{
                e.stopPropagation();
                const mm=parseInt(btn.dataset.mp);
                _dtpState.m=mm;
                const dmax=_dtpDaysInMonth(_dtpState.y, mm);
                if(_dtpState.d>dmax) _dtpState.d=dmax;
                _dtpMPOpen=false;
                _dtpRender(); requestAnimationFrame(_dtpScrollToSelected);
                _dtpSyncInput();
            });
        });
    }
    // klik di area kosong calendar tutup month picker
    _dtpPopup.querySelector('.dtp-cal').addEventListener('click', (e)=>{
        if(_dtpMPOpen && !e.target.closest('#dtp-mp') && !e.target.closest('#dtp-monthBtn')){
            _dtpMPOpen=false; _dtpRender(); requestAnimationFrame(_dtpScrollToSelected);
        }
    });
    _dtpPopup.querySelector('#dtp-clear').onclick = ()=>{ if(_dtpActive){ _dtpActive.value=''; _dtpActive.dispatchEvent(new Event('change',{bubbles:true})); } closeDTP(); };
    _dtpPopup.querySelector('#dtp-today').onclick = ()=>{ const n=new Date(); _dtpState.y=n.getFullYear(); _dtpState.m=n.getMonth(); _dtpState.d=n.getDate(); _dtpState.h=n.getHours(); _dtpState.mi=Math.floor(n.getMinutes()/1); _dtpSyncInput(); _dtpRender(); requestAnimationFrame(_dtpScrollToSelected); _dtpSyncInput(); };
    _dtpPopup.querySelectorAll('.dtp-day').forEach(el=>{
        el.addEventListener('click', ()=>{
            const o = el.getAttribute('data-other')==='1';
            const cd = parseInt(el.getAttribute('data-day'));
            const cm = parseInt(el.getAttribute('data-cm'));
            const cy = parseInt(el.getAttribute('data-cy'));
            if(o){ _dtpState.y=cy; _dtpState.m=cm; _dtpState.d=cd; _dtpRender(); requestAnimationFrame(_dtpScrollToSelected); }
            else { _dtpState.d=cd; _dtpPopup.querySelectorAll('.dtp-day').forEach(d=>d.classList.remove('selected')); el.classList.add('selected'); }
            _dtpSyncInput();
        });
    });
    _dtpPopup.querySelectorAll('.dtp-tok[data-h]').forEach(el=>{
        el.addEventListener('click', ()=>{
            const h=parseInt(el.getAttribute('data-h'));
            _dtpState.h=h;
            _dtpPopup.querySelectorAll('.dtp-tok[data-h]').forEach(x=>x.classList.remove('sel'));
            el.classList.add('sel');
            _dtpSyncInput();
            el.scrollIntoView({block:'nearest'});
        });
    });
    _dtpPopup.querySelectorAll('.dtp-tok[data-mi]').forEach(el=>{
        el.addEventListener('click', ()=>{
            const mi=parseInt(el.getAttribute('data-mi'));
            _dtpState.mi=mi;
            _dtpPopup.querySelectorAll('.dtp-tok[data-mi]').forEach(x=>x.classList.remove('sel'));
            el.classList.add('sel');
            _dtpSyncInput();
            el.scrollIntoView({block:'nearest'});
        });
    });
    // wheel scroll snap improvement: keep scroll always visible
    const hList = _dtpPopup.querySelector('#dtp-hlist');
    const miList = _dtpPopup.querySelector('#dtp-milist');
    // ensure scrollbars visible by forcing overflow scroll
    if(hList) hList.style.overflowY = 'scroll';
    if(miList) miList.style.overflowY = 'scroll';
}
function _dtpSyncDisplayFromISO(el){
    if(!el) return;
    const iso = el.dataset && el.dataset.iso ? el.dataset.iso : el.value;
    if(!iso) return;
    const d = new Date(iso);
    if(isNaN(d.getTime())){
        const p=_dtpParseDisplay(iso);
        if(p){ el.value=_dtpFormatDisplay(p); el.dataset.iso=_dtpToISOVal(p); }
        return;
    }
    const s={y:d.getFullYear(), m:d.getMonth(), d:d.getDate(), h:d.getHours(), mi:d.getMinutes()};
    el.value=_dtpFormatDisplay(s);
    el.dataset.iso=_dtpToISOVal(s);
}
function initCustomDateTimePicker(){
    _dtpEnsureDom();
    ['jadwal-waktu','jadwal-selesai'].forEach(id=>{
        const inp = document.getElementById(id);
        if(!inp || inp.dataset.dtpReady) return;
        inp.dataset.dtpReady='1';
        try{ inp.type='text'; }catch(e){}
        inp.setAttribute('readonly','readonly');
        inp.setAttribute('inputmode','none');
        inp.classList.add('dtp-input');
        inp.setAttribute('placeholder','dd/mm/yyyy HH:MM');
        inp.setAttribute('autocomplete','off');
        // bungkus dengan wrapper + ikon kalender agar tetap terlihat seperti native (desktop)
        try{
            if(!inp.parentElement.classList.contains('dtp-wrap')){
                const w=document.createElement('div');
                w.className='dtp-wrap';
                w.style.cssText='position:relative;display:block;';
                inp.parentNode.insertBefore(w, inp);
                w.appendChild(inp);
                const ic=document.createElement('i');
                ic.className='fas fa-calendar-alt';
                ic.style.cssText='position:absolute;right:10px;top:50%;transform:translateY(-50%);color:#64748b;font-size:13px;pointer-events:none;opacity:0.9;';
                w.appendChild(ic);
                // klik ikon juga buka
                w.addEventListener('click', e=>{ if(e.target===ic) { e.preventDefault(); openDTP(inp); inp.focus(); } });
            }
        }catch(e){}
        inp.addEventListener('click', e=>{ e.preventDefault(); openDTP(inp); });
        inp.addEventListener('focus', e=>{ e.preventDefault(); openDTP(inp); });
        inp.addEventListener('keydown', e=>{
            if(e.key==='Backspace' || e.key==='Delete'){ inp.value=''; inp.dispatchEvent(new Event('change',{bubbles:true})); closeDTP(); e.preventDefault(); }
            if(e.key==='Enter' || e.key===' '){ openDTP(inp); e.preventDefault(); }
        });
    });
}
// auto init — harus langsung jalan meski script di-load lazy setelah DOMContentLoaded
function _dtpInitNow(){
    try{ _dtpEnsureDom(); }catch(e){}
    initCustomDateTimePicker();
    if(!window.__dtpHooked && typeof window.bukaHalaman === 'function'){
        const _orig = window.bukaHalaman;
        window.bukaHalaman = function(a,b){ const r=_orig(a,b); if(a==='jadwal') setTimeout(initCustomDateTimePicker,80); return r; };
        window.__dtpHooked = true;
    }
    // observe jadwal section jika ada
    try{
        const jadwal = document.getElementById('jadwal');
        if(jadwal && !jadwal.dataset.dtpObs){
            jadwal.dataset.dtpObs='1';
            new MutationObserver(()=> initCustomDateTimePicker()).observe(jadwal,{attributes:true,attributeFilter:['class']});
        }
    }catch(e){}
}
if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', _dtpInitNow); } else { _dtpInitNow(); }
setTimeout(_dtpInitNow, 150);
setTimeout(_dtpInitNow, 900);
setTimeout(_dtpInitNow, 2000);
function filterJadwal(){
  const q = (document.getElementById('search-jadwal')?.value || '').trim().toLowerCase();
  const cards = document.querySelectorAll('#tabel-jadwal tr');
  if(!cards.length) return;
  cards.forEach(card=>{
    if(card.querySelector('td[colspan]')){
      if(q) card.style.setProperty('display','none','important');
      else card.style.removeProperty('display');
      return;
    }
    const txt = (card.innerText || '').toLowerCase();
    const show = !q || txt.includes(q);
    if(show) card.style.removeProperty('display');
    else card.style.setProperty('display','none','important');
  });
}
function handleSortJadwal(val){
  _jadwalSortBy = val || '';
  if(_jadwalLastData && _jadwalLastData.length){
    // re-render dari cache tanpa fetch ulang
    const tbody=document.getElementById('tabel-jadwal');
    if(tbody){
      // trigger re-render via loadJadwal dengan data cache? simplest: panggil loadJadwal tapi akan fetch lagi
      // kita sort DOM langsung untuk hemat request
      const rows=[...tbody.querySelectorAll('tr')].filter(r=> !r.querySelector('td[colspan]'));
      // jika belum ada data cache, fallback load
      if(!rows.length){ loadJadwal(); return; }
      // buat map id -> row untuk reorder berdasarkan sorted displayData
      const sorted=[..._jadwalLastData];
      if(_jadwalSortBy){
        const getT=v=> v? new Date(v).getTime():0;
        const getMod=j=> j.created_at? getT(j.created_at): (j.id||0);
        sorted.sort((a,b)=>{
          switch(_jadwalSortBy){
            case 'date-asc': return getT(a.waktu_mulai)-getT(b.waktu_mulai);
            case 'date-desc': return getT(b.waktu_mulai)-getT(a.waktu_mulai);
            case 'mod-desc': return getMod(b)-getMod(a);
            case 'mod-asc': return getMod(a)-getMod(b);
            case 'az': return String(a.mapel||'').localeCompare(String(b.mapel||''),'id');
            case 'za': return String(b.mapel||'').localeCompare(String(a.mapel||''),'id');
            default: return 0;
          }
        });
      }
      // reorder DOM sesuai sorted order
      const idToRow=new Map();
      rows.forEach(r=>{
        const cb=r.querySelector('.cb-jadwal'); if(cb) idToRow.set(String(cb.value), r);
      });
      sorted.forEach(j=>{
        const row=idToRow.get(String(j.id));
        if(row) tbody.appendChild(row);
      });
      try{ if(document.getElementById('search-jadwal')?.value) filterJadwal(); }catch(e){}
      return;
    }
  }
  loadJadwal();
}
window.filterJadwal = filterJadwal;
window.handleSortJadwal = handleSortJadwal;
// expose
window.openDTP = openDTP; window.closeDTP = closeDTP; window.initCustomDateTimePicker = initCustomDateTimePicker;
window._dtpInitNow = _dtpInitNow;
