// @ts-nocheck
// ============================================================
// admin-siswa.js — Data Kelas & Siswa (Master untuk login autocomplete)
// Format kelas: "X AKL A" (tanpa jurusan)
// Import gabung 1 file: kolom Nama | Kelas
// Login strict: siswa wajib ada di master
// ============================================================

let _kelasCache = [];
let _siswaPage = 1;
let _editingKelasId = null;
let _editingSiswaId = null;
const SISWA_PER_PAGE = 50;

// ===================== INIT =====================
async function initDataKelasSiswa() {
    await loadKelasMaster();
    await loadSiswa();
    bindSiswaEvents();
}

function bindSiswaEvents() {
    const searchEl = document.getElementById('search-siswa');
    if (searchEl && !searchEl.dataset.bound) {
        searchEl.dataset.bound = '1';
        let t = null;
        searchEl.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => { _siswaPage = 1; loadSiswa(); }, 250);
        });
    }
    const filterEl = document.getElementById('filter-kelas-siswa');
    if (filterEl && !filterEl.dataset.bound) {
        filterEl.dataset.bound = '1';
        filterEl.addEventListener('change', () => { _siswaPage = 1; loadSiswa(); });
    }
}

// ===================== KELAS — CRUD =====================
async function loadKelasMaster() {
    const tbody = document.getElementById('tabel-kelas');
    const selSiswaKelas = document.getElementById('siswa-kelas');
    const selFilterKelas = document.getElementById('filter-kelas-siswa');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;"><i class="fas fa-spinner fa-spin"></i> Memuat...</td></tr>';
    const { data, error } = await db.from('kelas').select('id,nama,is_aktif,created_at').order('nama', { ascending: true });
    if (error) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#f87171;">Gagal: ${error.message}</td></tr>`;
        return;
    }
    _kelasCache = data || [];
    // hitung jml siswa per kelas
    const { data: counts } = await db.from('siswa').select('kelas_id').eq('is_aktif', true);
    const countMap = {};
    (counts || []).forEach(r => { if (r.kelas_id) countMap[r.kelas_id] = (countMap[r.kelas_id] || 0) + 1; });

    // populate selects
    const opts = '<option value="">— Pilih Kelas —</option>' + _kelasCache.filter(k => k.is_aktif).map(k => `<option value="${k.id}">${k.nama}</option>`).join('');
    if (selSiswaKelas) { const prev = selSiswaKelas.value; selSiswaKelas.innerHTML = opts; if (prev) selSiswaKelas.value = prev; }
    const filterOpts = '<option value="">Semua Kelas</option><option value="__null">Tanpa Kelas</option>' + _kelasCache.map(k => `<option value="${k.id}">${k.nama}</option>`).join('');
    if (selFilterKelas) { const pf = selFilterKelas.value; selFilterKelas.innerHTML = filterOpts; selFilterKelas.value = pf; if (selFilterKelas.dataset.cslReady) syncCustomSelect('filter-kelas-siswa'); }

    // jadwal multi-select juga butuh refresh
    if (typeof populateJadwalKelasOptions === 'function') populateJadwalKelasOptions();

    // stats
    const elTot = document.getElementById('stat-total-kelas');
    const elAkt = document.getElementById('stat-kelas-aktif');
    const elSis = document.getElementById('stat-total-siswa');
    if (elTot) elTot.textContent = _kelasCache.length;
    if (elAkt) elAkt.textContent = _kelasCache.filter(k => k.is_aktif).length;
    if (elSis) {
        const { count } = await db.from('siswa').select('*', { count: 'exact', head: true }).eq('is_aktif', true);
        elSis.textContent = count ?? '-';
    }

    if (_kelasCache.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">Belum ada kelas. Tambahkan di form sebelah kiri atau import Excel.</td></tr>';
        return;
    }
    tbody.innerHTML = _kelasCache.map((k, i) => {
        const jml = countMap[k.id] || 0;
        return `<tr>
            <td style="text-align:center;">${i + 1}</td>
            <td style="font-weight:700;color:var(--text-main);">${k.nama}</td>
            <td style="text-align:center;"><span class="badge" style="background:rgba(59,130,246,0.1);color:#93c5fd;border:1px solid rgba(59,130,246,0.2);">${jml} siswa</span></td>
            <td style="text-align:center;"><label class="toggle"><input type="checkbox" ${k.is_aktif ? 'checked' : ''} onchange="toggleKelasAktif(${k.id}, this.checked)"><span class="toggle-slider"></span></label></td>
            <td style="text-align:center;">
                <button class="btn btn-outline" style="padding:5px 8px;font-size:11px;" onclick="mulaiEditKelas(${k.id})" title="Edit"><i class="fas fa-pen"></i></button>
                <button class="btn btn-danger" style="padding:5px 8px;font-size:11px;" onclick="hapusKelas(${k.id}, '${k.nama.replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');
}

async function simpanKelas() {
    const inp = document.getElementById('kelas-nama');
    const statusEl = document.getElementById('status-kelas');
    if (!inp) return;
    const nama = inp.value.trim();
    if (!nama) { if (statusEl) statusEl.innerHTML = '<span style="color:#f87171;">Nama kelas wajib diisi</span>'; return; }
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Menyimpan...</span>';
    if (_editingKelasId) {
        const { error } = await adminDb.update('kelas', _editingKelasId, { nama });
        if (error) { if (statusEl) statusEl.innerHTML = `<span style="color:#f87171;">Gagal: ${error.message}</span>`; return; }
        _editingKelasId = null;
        const btn = document.getElementById('btn-simpan-kelas');
        if (btn) btn.innerHTML = '<i class="fas fa-plus"></i> Tambah Kelas';
        if (statusEl) statusEl.innerHTML = '<span style="color:#34d399;">Kelas diperbarui</span>';
    } else {
        const { error } = await adminDb.insert('kelas', [{ nama, is_aktif: true }]);
        if (error) {
            let msg = error.message;
            if (msg.includes('duplicate') || msg.includes('unique')) msg = 'Nama kelas sudah ada';
            if (statusEl) statusEl.innerHTML = `<span style="color:#f87171;">Gagal: ${msg}</span>`;
            return;
        }
        if (statusEl) statusEl.innerHTML = '<span style="color:#34d399;">Kelas ditambahkan</span>';
    }
    inp.value = '';
    setTimeout(() => { if (statusEl) statusEl.innerHTML = ''; }, 2000);
    loadKelasMaster();
}

function mulaiEditKelas(id) {
    const k = _kelasCache.find(x => x.id === id);
    if (!k) return;
    _editingKelasId = id;
    const inp = document.getElementById('kelas-nama');
    if (inp) { inp.value = k.nama; inp.focus(); }
    const btn = document.getElementById('btn-simpan-kelas');
    if (btn) btn.innerHTML = '<i class="fas fa-save"></i> Update Kelas';
}

function batalEditKelas() {
    _editingKelasId = null;
    const inp = document.getElementById('kelas-nama');
    if (inp) inp.value = '';
    const btn = document.getElementById('btn-simpan-kelas');
    if (btn) btn.innerHTML = '<i class="fas fa-plus"></i> Tambah Kelas';
    const statusEl = document.getElementById('status-kelas');
    if (statusEl) statusEl.innerHTML = '';
}

async function toggleKelasAktif(id, val) {
    const { error } = await adminDb.update('kelas', id, { is_aktif: val });
    if (error) { showToast('Gagal ubah status: ' + error.message, 'error'); loadKelasMaster(); }
    else { showToast(val ? 'Kelas diaktifkan' : 'Kelas dinonaktifkan', 'info'); loadKelasMaster(); }
}

async function hapusKelas(id, nama) {
    // cek apakah dipakai jadwal
    const { data: jadwalPakai } = await db.from('jadwal_ujian').select('id').ilike('kelas', `%${nama}%`).limit(1);
    if (jadwalPakai && jadwalPakai.length > 0) {
        showToast(`Tidak bisa hapus "${nama}" — masih dipakai jadwal ujian. Nonaktifkan saja atau ubah jadwal dulu.`, 'error');
        return;
    }
    if (!await asyncConfirm(`Hapus kelas <b>"${nama}"</b>? Siswa di kelas ini akan jadi tanpa kelas.`, 'Hapus Kelas?')) return;
    const { data: saved } = await db.from('kelas').select('*').eq('id', id).single();
    const { error } = await adminDb.delete('kelas', id);
    if (error) { showToast('Gagal hapus: ' + error.message, 'error'); return; }
    showToast(`Kelas "${nama}" dihapus`, 'success', async () => {
        if (saved) { await adminDb.insert('kelas', [saved]); loadKelasMaster(); showToast('Kelas dipulihkan', 'success'); }
    }, 'Undo');
    loadKelasMaster();
}

// ===================== SISWA — CRUD =====================
async function loadSiswa() {
    const tbody = document.getElementById('tabel-siswa');
    if (!tbody) return;
    const q = (document.getElementById('search-siswa')?.value || '').trim();
    const filterKelasId = document.getElementById('filter-kelas-siswa')?.value || '';
    const pageInfo = document.getElementById('siswa-page-info');
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:16px;"><i class="fas fa-spinner fa-spin"></i> Memuat...</td></tr>`;

    // build base query count
    let countQuery = db.from('siswa').select('*', { count: 'exact', head: true }).eq('is_aktif', true);
    if (filterKelasId === '__null') countQuery = countQuery.is('kelas_id', null);
    else if (filterKelasId) countQuery = countQuery.eq('kelas_id', parseInt(filterKelasId, 10));
    if (q.length >= 1) countQuery = countQuery.ilike('nama', `%${q}%`);
    const { count: totalCount } = await countQuery;

    const total = totalCount || 0;
    const totalPages = Math.max(1, Math.ceil(total / SISWA_PER_PAGE));
    if (_siswaPage > totalPages) _siswaPage = totalPages;
    const from = (_siswaPage - 1) * SISWA_PER_PAGE;
    const to = from + SISWA_PER_PAGE - 1;

    let query = db.from('siswa').select('id,nama,kelas_id,is_aktif,created_at, kelas:kelas_id(nama)', { count: 'exact' }).eq('is_aktif', true).order('nama', { ascending: true }).range(from, to);
    if (filterKelasId === '__null') query = db.from('siswa').select('id,nama,kelas_id,is_aktif,created_at, kelas:kelas_id(nama)', { count: 'exact' }).eq('is_aktif', true).is('kelas_id', null).order('nama', { ascending: true }).range(from, to);
    else if (filterKelasId) query = db.from('siswa').select('id,nama,kelas_id,is_aktif,created_at, kelas:kelas_id(nama)', { count: 'exact' }).eq('is_aktif', true).eq('kelas_id', parseInt(filterKelasId, 10)).order('nama', { ascending: true }).range(from, to);
    if (q.length >= 1) {
        // re-apply ilike (need to rebuild correctly: supabase chaining needs redo)
        let q2 = db.from('siswa').select('id,nama,kelas_id,is_aktif,created_at, kelas:kelas_id(nama)').eq('is_aktif', true).ilike('nama', `%${q}%`).order('nama', { ascending: true }).range(from, to);
        if (filterKelasId === '__null') q2 = q2.is('kelas_id', null);
        else if (filterKelasId) q2 = q2.eq('kelas_id', parseInt(filterKelasId, 10));
        const { data, error } = await q2;
        if (error) { tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#f87171;">${error.message}</td></tr>`; return; }
        renderSiswaRows(data || [], from, total, pageInfo);
        return;
    }
    const { data, error } = await query;
    if (error) { tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#f87171;">${error.message}</td></tr>`; return; }
    renderSiswaRows(data || [], from, total, pageInfo);
}

function renderSiswaRows(data, from, total, pageInfo) {
    const tbody = document.getElementById('tabel-siswa');
    if (pageInfo) {
        const start = total === 0 ? 0 : from + 1;
        const end = Math.min(from + SISWA_PER_PAGE, total);
        pageInfo.textContent = `Menampilkan ${start}-${end} dari ${total} siswa`;
    }
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">Tidak ada data. Tambahkan manual atau import Excel.</td></tr>';
        return;
    }
    tbody.innerHTML = data.map((s, idx) => {
        const no = from + idx + 1;
        const kelasNama = s.kelas ? s.kelas.nama : '<span style="color:var(--text-muted);font-style:italic;">Tanpa kelas</span>';
        return `<tr>
            <td style="text-align:center;">${no}</td>
            <td style="font-weight:600;">${s.nama}</td>
            <td style="text-align:center;"><span class="badge" style="background:rgba(59,130,246,0.1);color:#93c5fd;border:1px solid rgba(59,130,246,0.2);">${kelasNama}</span></td>
            <td style="text-align:center;"><span class="badge" style="background:rgba(16,185,129,0.1);color:#34d399;border:1px solid rgba(16,185,129,0.2);">Aktif</span></td>
            <td style="text-align:center;">
                <button class="btn btn-outline" style="padding:5px 8px;font-size:11px;" onclick="mulaiEditSiswa(${s.id})"><i class="fas fa-pen"></i></button>
                <button class="btn btn-danger" style="padding:5px 8px;font-size:11px;" onclick="hapusSiswa(${s.id}, '${s.nama.replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');
}

function changeSiswaPage(delta) {
    _siswaPage += delta;
    if (_siswaPage < 1) _siswaPage = 1;
    loadSiswa();
}

async function simpanSiswa() {
    const namaEl = document.getElementById('siswa-nama');
    const kelasEl = document.getElementById('siswa-kelas');
    const statusEl = document.getElementById('status-siswa');
    if (!namaEl || !kelasEl) return;
    const nama = namaEl.value.trim();
    const kelasId = kelasEl.value ? parseInt(kelasEl.value, 10) : null;
    if (!nama) { if (statusEl) statusEl.innerHTML = '<span style="color:#f87171;">Nama wajib diisi</span>'; return; }
    if (!kelasId) { if (statusEl) statusEl.innerHTML = '<span style="color:#f87171;">Pilih kelas</span>'; return; }
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Menyimpan...</span>';
    if (_editingSiswaId) {
        const { error } = await adminDb.update('siswa', _editingSiswaId, { nama, kelas_id: kelasId });
        if (error) {
            let msg = error.message;
            if (msg.includes('duplicate') || msg.includes('unique')) msg = 'Nama sudah ada di kelas ini';
            if (statusEl) statusEl.innerHTML = `<span style="color:#f87171;">Gagal: ${msg}</span>`;
            return;
        }
        _editingSiswaId = null;
        const btn = document.getElementById('btn-simpan-siswa');
        if (btn) btn.innerHTML = '<i class="fas fa-plus"></i> Tambah Siswa';
        if (statusEl) statusEl.innerHTML = '<span style="color:#34d399;">Siswa diperbarui</span>';
    } else {
        const { error } = await adminDb.insert('siswa', [{ nama, kelas_id: kelasId, is_aktif: true }]);
        if (error) {
            let msg = error.message;
            if (msg.includes('duplicate') || msg.includes('unique')) msg = 'Nama sudah ada di kelas ini';
            if (statusEl) statusEl.innerHTML = `<span style="color:#f87171;">Gagal: ${msg}</span>`;
            return;
        }
        if (statusEl) statusEl.innerHTML = '<span style="color:#34d399;">Siswa ditambahkan</span>';
    }
    namaEl.value = '';
    kelasEl.value = '';
    setTimeout(() => { if (statusEl) statusEl.innerHTML = ''; }, 2500);
    loadSiswa();
    loadKelasMaster();
}

async function mulaiEditSiswa(id) {
    const { data, error } = await db.from('siswa').select('id,nama,kelas_id').eq('id', id).single();
    if (error || !data) return;
    _editingSiswaId = id;
    const namaEl = document.getElementById('siswa-nama');
    const kelasEl = document.getElementById('siswa-kelas');
    if (namaEl) namaEl.value = data.nama;
    if (kelasEl) kelasEl.value = data.kelas_id || '';
    const btn = document.getElementById('btn-simpan-siswa');
    if (btn) btn.innerHTML = '<i class="fas fa-save"></i> Update Siswa';
    document.getElementById('siswa-nama')?.focus();
    // switch to siswa tab if needed
    const tabSiswa = document.getElementById('tab-siswa');
    if (tabSiswa && !tabSiswa.classList.contains('active')) switchKelasSiswaTab('siswa');
}

function batalEditSiswa() {
    _editingSiswaId = null;
    const namaEl = document.getElementById('siswa-nama');
    const kelasEl = document.getElementById('siswa-kelas');
    if (namaEl) namaEl.value = '';
    if (kelasEl) kelasEl.value = '';
    const btn = document.getElementById('btn-simpan-siswa');
    if (btn) btn.innerHTML = '<i class="fas fa-plus"></i> Tambah Siswa';
    const statusEl = document.getElementById('status-siswa');
    if (statusEl) statusEl.innerHTML = '';
}

async function hapusSiswa(id, nama) {
    if (!await asyncConfirm(`Hapus siswa <b>"${nama}"</b>?`, 'Hapus Siswa?')) return;
    const { data: saved } = await db.from('siswa').select('*').eq('id', id).single();
    const { error } = await adminDb.delete('siswa', id);
    if (error) { showToast('Gagal hapus: ' + error.message, 'error'); return; }
    showToast(`Siswa "${nama}" dihapus`, 'success', async () => {
        if (saved) { await adminDb.insert('siswa', [saved]); loadSiswa(); loadKelasMaster(); showToast('Siswa dipulihkan', 'success'); }
    }, 'Undo');
    loadSiswa();
    loadKelasMaster();
}

async function bulkHapusSiswa() {
    const cbs = document.querySelectorAll('#tabel-siswa input[type="checkbox"]:checked');
    // fallback: if no checkbox col, use selected via prompt — but we have no checkbox, add bulk via filter
    showToast('Pilih hapus via tombol per baris atau gunakan filter + hapus terpilih (coming soon)', 'info');
}

// ===================== IMPORT EXCEL GABUNG =====================
async function importSiswaExcel(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const statusEl = document.getElementById('status-import-siswa');
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Membaca file...</span>';
    try {
        if (typeof XLSX === 'undefined') {
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
        }
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (!rows || rows.length < 2) throw new Error('File kosong atau tanpa header');
        const header = rows[0].map(h => String(h).trim().toLowerCase());
        let idxNama = header.findIndex(h => ['nama','nama lengkap','nama siswa'].includes(h));
        let idxKelas = header.findIndex(h => ['kelas','kelas siswa','kelassiswa'].includes(h));
        if (idxNama === -1) idxNama = 0;
        if (idxKelas === -1) idxKelas = 1;
        const raw = rows.slice(1).map(r => ({ nama: String(r[idxNama] || '').trim(), kelasNama: String(r[idxKelas] || '').trim() })).filter(r => r.nama && r.kelasNama);
        if (raw.length === 0) throw new Error('Tidak ada baris valid (butuh kolom Nama & Kelas terisi)');
        // dedup within file by nama+kelas lower
        const seen = new Set();
        const dedup = [];
        raw.forEach(r => {
            const key = r.nama.toLowerCase() + '::' + r.kelasNama.toLowerCase();
            if (!seen.has(key)) { seen.add(key); dedup.push(r); }
        });
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--text-muted);">Ditemukan ${dedup.length} baris unik. Memproses kelas...</span>`;
        // ensure kelas exist
        const uniqueKelas = [...new Set(dedup.map(r => r.kelasNama))];
        // fetch existing kelas
        const { data: existingKelas } = await db.from('kelas').select('id,nama');
        const kelasMap = new Map((existingKelas || []).map(k => [k.nama.toLowerCase(), k.id]));
        const newKelasNames = uniqueKelas.filter(n => !kelasMap.has(n.toLowerCase()));
        if (newKelasNames.length > 0) {
            const newKelasRows = newKelasNames.map(nama => ({ nama, is_aktif: true }));
            const { error: insKErr } = await adminDb.insert('kelas', newKelasRows);
            if (insKErr && !insKErr.message.includes('duplicate')) throw new Error('Gagal buat kelas baru: ' + insKErr.message);
            // refetch
            const { data: refetched } = await db.from('kelas').select('id,nama');
            (refetched || []).forEach(k => kelasMap.set(k.nama.toLowerCase(), k.id));
        }
        // build siswa rows
        const siswaRows = dedup.map(r => ({ nama: r.nama, kelas_id: kelasMap.get(r.kelasNama.toLowerCase()) || null, is_aktif: true })).filter(r => r.kelas_id);
        if (siswaRows.length === 0) throw new Error('Semua baris kelas tidak valid');
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--text-muted);">Mengimpor ${siswaRows.length} siswa (kelas baru: ${newKelasNames.length})...</span>`;
        // chunked insert, handle duplicate via try per chunk and report
        let inserted = 0, skipped = 0;
        for (let i = 0; i < siswaRows.length; i += 50) {
            const chunk = siswaRows.slice(i, i + 50);
            const { error } = await adminDb.insert('siswa', chunk);
            if (error) {
                // if duplicate error, try one-by-one to count skipped
                if (error.message.includes('duplicate') || error.message.includes('unique')) {
                    for (const row of chunk) {
                        const { error: e2 } = await adminDb.insert('siswa', [row]);
                        if (e2) skipped++; else inserted++;
                    }
                } else {
                    throw new Error(error.message);
                }
            } else {
                inserted += chunk.length;
            }
        }
        if (statusEl) statusEl.innerHTML = `<span style="color:#34d399;"><i class="fas fa-check-circle"></i> Selesai: ${inserted} ditambahkan, ${skipped} dilewati (duplikat), ${newKelasNames.length} kelas baru.</span>`;
        loadKelasMaster();
        loadSiswa();
    } catch (e) {
        if (statusEl) statusEl.innerHTML = `<span style="color:#f87171;">Gagal import: ${e.message}</span>`;
    } finally {
        input.value = '';
    }
}

function downloadTemplateSiswa() {
    // build template xlsx
    if (typeof XLSX === 'undefined') {
        loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js').then(() => downloadTemplateSiswa());
        return;
    }
    const data = [
        ['Nama', 'Kelas'],
        ['Ahmad Fauzi', 'X AKL A'],
        ['Siti Rahayu', 'X AKL A'],
        ['Budi Santoso', 'X AKL B'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 28 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Siswa');
    XLSX.writeFile(wb, 'Template_Siswa_Kelas.xlsx');
}

// ===================== TAB SWITCH =====================
function switchKelasSiswaTab(tab) {
    const btnKelas = document.getElementById('btn-tab-kelas');
    const btnSiswa = document.getElementById('btn-tab-siswa');
    const paneKelas = document.getElementById('pane-kelas');
    const paneSiswa = document.getElementById('pane-siswa');
    if (tab === 'kelas') {
        btnKelas?.classList.add('active');
        btnSiswa?.classList.remove('active');
        if (paneKelas) paneKelas.style.display = '';
        if (paneSiswa) paneSiswa.style.display = 'none';
    } else {
        btnSiswa?.classList.add('active');
        btnKelas?.classList.remove('active');
        if (paneSiswa) paneSiswa.style.display = '';
        if (paneKelas) paneKelas.style.display = 'none';
    }
}

// ===================== EXPORT HELPERS =====================
async function exportSiswaExcel() {
    if (typeof XLSX === 'undefined') {
        try { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'); } catch { return showToast('Gagal load XLSX', 'error'); }
    }
    const { data, error } = await db.from('siswa').select('nama, kelas:kelas_id(nama)').eq('is_aktif', true).order('nama', { ascending: true });
    if (error || !data || data.length === 0) { showToast('Tidak ada data siswa untuk diekspor', 'info'); return; }
    const rows = [['Nama', 'Kelas']].concat(data.map(r => [r.nama, r.kelas ? r.kelas.nama : '']));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 28 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Siswa');
    XLSX.writeFile(wb, 'Data_Siswa.xlsx');
}
