// @ts-nocheck
// ============================================================
// admin-soal-folder.js — Bank Soal sebagai file explorer
// Fungsi:
//   - Render folder (bertingkat, maks 3 level) + soal di folder aktif
//   - Buat / rename / pindahkan / hapus folder
//   - Pindahkan soal antar folder, hapus soal massal
//   - Cari folder + teks soal (global)
//   - bsPickFolder(): modal pemilih folder (dipakai simpan manual,
//     import Excel/Word, generate AI, dan pindah soal)
//
// Catatan: `mapel` TIDAK diubah oleh file ini. mapel tetap dipakai
// jadwal ujian, koreksi nilai, analisis, laporan. Folder = arsip.
// ============================================================

const BS_MAX_DEPTH = 3;

const bsState = {
    folders: [],          // folder milik sesi ini (admin: semua)
    allFolders: [],       // semua folder yang terbaca
    counts: {},           // key folder -> jumlah soal langsung
    mapels: [],
    currentFolderId: null,
    soalByFolder: {},     // cache daftar soal per folder
    renderLimit: 40,
    search: '',
    searchToken: 0,
    searchSoal: null,     // null = bukan mode cari, [] = hasil kosong
    searchFolders: [],
    selected: new Set(),
    previewMapel: null,
    _searchTimer: null,
    _bound: false,
    _loading: null,
    _mjPromise: null
};

// ---------- SESI ----------
function bsIsAdmin() {
    const s = (typeof getGuruSession === 'function') ? getGuruSession() : null;
    return !!(s && (s.isAdmin === true || s.role === 'admin' || s.role === 'superadmin'));
}
function bsGuruId() {
    const s = (typeof getGuruSession === 'function') ? getGuruSession() : null;
    return s ? s.id : null;
}

// ---------- UTIL ----------
function bsEsc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function bsFKey(id) {
    return (id === null || id === undefined || id === '') ? 'root' : String(id);
}
function bsPlainText(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    return (tmp.textContent || '').replace(/\s+/g, ' ').trim();
}
function bsLoading(on, msg) {
    try {
        if (on) {
            if (typeof showGlobalLoader === 'function') showGlobalLoader(msg || 'Memproses...', { immediate: true });
        } else if (typeof hideGlobalLoader === 'function') hideGlobalLoader();
    } catch (_) { /* noop */ }
}
function bsToast(msg, type, undo, undoLabel) {
    if (typeof showToast === 'function') showToast(msg, type || 'success', undo, undoLabel);
    else if (window.Swal) Swal.fire({ icon: type === 'error' ? 'error' : 'success', title: msg });
}

// fetch semua baris (melewati limit 1000 Supabase)
async function bsFetchAll(selectCols, applyFilter) {
    const PAGE = 1000;
    let all = [];
    let from = 0;
    while (true) {
        let q = db.from('bank_soal').select(selectCols).order('id', { ascending: true }).range(from, from + PAGE - 1);
        if (applyFilter) q = applyFilter(q);
        const { data, error } = await q;
        if (error) return { data: null, error };
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
        if (from > 40000) break; // safety
    }
    return { data: all, error: null };
}

// ---------- DATA ----------
async function bsLoadFolders() {
    const { data, error } = await db.from('bank_soal_folder').select('*').order('nama', { ascending: true });
    if (error) return { error };
    const isAdmin = bsIsAdmin();
    const gid = bsGuruId();
    bsState.allFolders = data || [];
    bsState.folders = (data || []).filter(f => isAdmin || String(f.created_by) === String(gid));
    return { error: null };
}

function bsFindFolder(id) {
    if (id === null || id === undefined) return null;
    return bsState.allFolders.find(f => String(f.id) === String(id))
        || bsState.folders.find(f => String(f.id) === String(id))
        || null;
}

function bsFolderChain(id) {
    const chain = [];
    let cur = bsFindFolder(id);
    let guard = 0;
    while (cur && guard < 10) {
        chain.unshift(cur);
        cur = cur.parent_id ? bsFindFolder(cur.parent_id) : null;
        guard++;
    }
    return chain;
}
function bsFolderPath(id) {
    const chain = bsFolderChain(id);
    return chain.length ? chain.map(f => f.nama).join(' / ') : 'Bank Soal';
}
function bsFolderDepth(id) {
    return bsFolderChain(id).length; // root = 0, folder level 1 = 1, dst
}
function bsChildren(parentId) {
    return bsState.folders
        .filter(f => String(f.parent_id || '') === String(parentId || ''))
        .sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'));
}
function bsCollectSubtree(id, out) {
    out = out || [];
    if (out.some(x => String(x) === String(id))) return out;
    out.push(id);
    bsState.folders
        .filter(f => String(f.parent_id) === String(id))
        .forEach(f => bsCollectSubtree(f.id, out));
    return out;
}
function bsSubtreeHeight(id) {
    const kids = bsState.folders.filter(f => String(f.parent_id) === String(id));
    if (!kids.length) return 1;
    return 1 + Math.max(...kids.map(k => bsSubtreeHeight(k.id)));
}
function bsIsDescendant(candidateId, ancestorId) {
    if (!candidateId) return false;
    let cur = bsFindFolder(candidateId);
    let guard = 0;
    while (cur && guard < 10) {
        if (String(cur.id) === String(ancestorId)) return true;
        cur = cur.parent_id ? bsFindFolder(cur.parent_id) : null;
        guard++;
    }
    return false;
}
function bsFolderTotalSoal(id) {
    let total = bsState.counts[bsFKey(id)] || 0;
    bsChildren(id).forEach(ch => { total += bsFolderTotalSoal(ch.id); });
    return total;
}

async function bsLoadIndex() {
    const isAdmin = bsIsAdmin();
    const gid = bsGuruId();
    const { data, error } = await bsFetchAll('folder_id, mapel, created_by', (q) => {
        if (!isAdmin && gid) return q.eq('created_by', gid);
        return q;
    });
    if (error || !data) return { error };
    const counts = {};
    const mapels = new Set();
    data.forEach(r => {
        const key = bsFKey(r.folder_id);
        counts[key] = (counts[key] || 0) + 1;
        if (r.mapel) mapels.add(String(r.mapel).trim());
    });
    bsState.counts = counts;
    bsState.mapels = [...mapels].sort((a, b) => a.localeCompare(b, 'id'));
    return { error: null };
}

async function bsLoadSoalFolder(folderId, force) {
    const key = bsFKey(folderId);
    if (!force && bsState.soalByFolder[key]) return { data: bsState.soalByFolder[key], error: null };
    const isAdmin = bsIsAdmin();
    const gid = bsGuruId();
    const cols = 'id, mapel, tipe_soal, pertanyaan, opsi_a, opsi_b, opsi_c, opsi_d, opsi_e, kunci_jawaban, folder_id, created_by';
    const PAGE = 1000;
    let all = [];
    let from = 0;
    while (true) {
        let q = db.from('bank_soal').select(cols).order('id', { ascending: false }).range(from, from + PAGE - 1);
        if (folderId === null || folderId === undefined) q = q.is('folder_id', null);
        else q = q.eq('folder_id', folderId);
        if (!isAdmin && gid) q = q.eq('created_by', gid);
        const { data, error } = await q;
        if (error) return { data: null, error };
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
        if (from > 40000) break;
    }
    bsState.soalByFolder[key] = all;
    return { data: all, error: null };
}

// ---------- REFRESH + RENDER ----------
async function bsRefreshExplorer(opts) {
    opts = opts || {};
    const listEl = document.getElementById('bs-file-list');
    if (!listEl) return;

    bsBindUi();
    if (bsState._loading) return bsState._loading;

    if (!bsState.soalByFolder[bsFKey(bsState.currentFolderId)]) {
        listEl.innerHTML = '<div class="bs-loading"><i class="fas fa-spinner fa-spin"></i> Memuat bank soal...</div>';
    }

    bsState._loading = (async () => {
        const fRes = await bsLoadFolders();
        if (fRes.error) {
            listEl.innerHTML = `<div class="bs-error"><i class="fas fa-exclamation-circle"></i> Gagal memuat folder: ${bsEsc(fRes.error.message)}</div>`;
            return;
        }
        // folder aktif mungkin sudah dihapus
        if (bsState.currentFolderId !== null && !bsFindFolder(bsState.currentFolderId)) {
            bsState.currentFolderId = null;
        }
        bsState.soalByFolder = {};
        const iRes = await bsLoadIndex();
        if (iRes.error) {
            listEl.innerHTML = `<div class="bs-error"><i class="fas fa-exclamation-circle"></i> Gagal memuat bank soal: ${bsEsc(iRes.error.message)}</div>`;
            return;
        }
        const sRes = await bsLoadSoalFolder(bsState.currentFolderId, true);
        if (sRes.error) {
            listEl.innerHTML = `<div class="bs-error"><i class="fas fa-exclamation-circle"></i> Gagal memuat soal: ${bsEsc(sRes.error.message)}</div>`;
            return;
        }
        bsState.renderLimit = opts.keepLimit ? bsState.renderLimit : 40;
        bsState.selected.clear();
        // hindari checkbox lama di panel preview ikut ke aksi massal explorer
        document.querySelectorAll('#preview-container .cb-soal').forEach(cb => { cb.checked = false; });
        bsSyncJadwalDropdown();
        bsRender();
    })();

    try { await bsState._loading; } finally { bsState._loading = null; }
}

function bsBindUi() {
    if (bsState._bound) return;
    const inp = document.getElementById('bs-search');
    if (!inp) return;
    inp.addEventListener('input', () => {
        clearTimeout(bsState._searchTimer);
        bsState._searchTimer = setTimeout(() => bsOnSearch(), 280);
    });
    inp.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { inp.value = ''; bsClearSearch(); }
    });
    bsState._bound = true;
}

function bsSyncJadwalDropdown() {
    try {
        if (typeof populateJadwalMapelDropdown === 'function') {
            populateJadwalMapelDropdown();
            return;
        }
    } catch (_) { /* noop */ }
    const sel = document.getElementById('jadwal-mapel');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Pilih Mapel dari Bank Soal —</option>'
        + bsState.mapels.map(m => `<option value="${bsEsc(m)}">${bsEsc(m)}</option>`).join('');
    if (bsState.mapels.includes(cur)) sel.value = cur;
}

function bsRenderBreadcrumb() {
    const el = document.getElementById('bs-breadcrumb');
    if (!el) return;
    const chain = bsFolderChain(bsState.currentFolderId);
    let html = `<button type="button" class="bs-crumb ${chain.length ? '' : 'active'}" onclick="bsBukaFolder(null)"><i class="fas fa-house"></i> Bank Soal</button>`;
    chain.forEach((f, i) => {
        html += '<i class="fas fa-chevron-right bs-crumb-sep"></i>';
        if (i === chain.length - 1) {
            html += `<span class="bs-crumb active" title="${bsEsc(f.nama)}">${bsEsc(f.nama)}</span>`;
        } else {
            html += `<button type="button" class="bs-crumb" onclick="bsBukaFolder(${Number(f.id)})" title="${bsEsc(f.nama)}">${bsEsc(f.nama)}</button>`;
        }
    });
    el.innerHTML = html;
}

function bsFolderCardHtml(f, showPath) {
    const total = bsFolderTotalSoal(f.id);
    const sub = bsChildren(f.id).length;
    const parts = [`${total} soal`];
    if (sub) parts.push(`${sub} subfolder`);
    if (showPath) parts.push(bsFolderPath(f.parent_id));
    return `
        <div class="bs-folder-card" role="button" tabindex="0" data-id="${Number(f.id)}"
            onclick="bsBukaFolder(${Number(f.id)})"
            onkeydown="if(event.key==='Enter'){bsBukaFolder(${Number(f.id)});}">
            <span class="bs-folder-icon"><i class="fas fa-folder"></i></span>
            <span class="bs-folder-body">
                <span class="bs-folder-name" title="${bsEsc(f.nama)}">${bsEsc(f.nama)}</span>
                <span class="bs-folder-sub">${bsEsc(parts.join(' · '))}</span>
            </span>
            <span class="bs-folder-menu" role="button" tabindex="0" title="Aksi folder"
                onclick="event.stopPropagation();bsFolderMenu(${Number(f.id)}, event)"
                onkeydown="event.stopPropagation();if(event.key==='Enter'){bsFolderMenu(${Number(f.id)}, event);}">
                <i class="fas fa-ellipsis-vertical"></i>
            </span>
        </div>`;
}

function bsRenderFolders() {
    const el = document.getElementById('bs-folder-grid');
    if (!el) return;
    let list;
    let showPath = false;
    if (bsState.search && bsState.searchSoal !== null) {
        list = bsState.searchFolders;
        showPath = true;
    } else {
        list = bsChildren(bsState.currentFolderId);
    }
    if (!list.length) {
        el.innerHTML = '';
        el.style.display = 'none';
        return;
    }
    el.style.display = 'grid';
    el.innerHTML = list.map(f => bsFolderCardHtml(f, showPath)).join('');
}

function bsSoalOptionsHtml(s) {
    if (!s || s.tipe_soal === 'ESSAY') return '';
    let html = '<ul class="bs-opts">';
    ['a', 'b', 'c', 'd', 'e'].forEach(o => {
        const val = s['opsi_' + o];
        if (!val) return;
        const txt = bsPlainText(val);
        if (!txt && !/<(img|audio|video|iframe)/i.test(val)) return;
        const isKey = String(s.kunci_jawaban || '').trim().toUpperCase() === o.toUpperCase();
        html += `<li class="${isKey ? 'is-key' : ''}"><b>${o.toUpperCase()}.</b><span dir="auto">${val}</span></li>`;
    });
    html += '</ul>';
    return html;
}

function bsSoalHtml(s, idx, showPath) {
    const tipe = String(s.tipe_soal || 'PG').toUpperCase();
    const isPg = tipe !== 'ESSAY';
    const pathBadge = showPath
        ? `<span class="bs-tag path" title="${bsEsc(bsFolderPath(s.folder_id))}"><i class="fas fa-folder"></i> ${bsEsc(bsFolderPath(s.folder_id))}</span>`
        : '';
    const key = String(s.kunci_jawaban || '').trim();
    return `
        <div class="bs-soal-row" data-id="${Number(s.id)}" data-mapel="${bsEsc(s.mapel || '')}">
            <input type="checkbox" class="cb-soal bs-cb-soal" value="${Number(s.id)}" onchange="bsSyncSelection()">
            <div class="bs-soal-main">
                <div class="bs-soal-meta">
                    <span class="bs-tag ${isPg ? 'pg' : 'essay'}">${bsEsc(tipe)}</span>
                    ${s.mapel ? `<span class="bs-tag mapel" title="${bsEsc(s.mapel)}">${bsEsc(s.mapel)}</span>` : ''}
                    ${pathBadge}
                    <span class="bs-soal-no">#${idx + 1}</span>
                </div>
                <div class="bs-soal-text" dir="auto" onclick="bsToggleSoalExpand(this)">${s.pertanyaan || '<em>(pertanyaan kosong)</em>'}</div>
                <div class="bs-soal-detail">
                    ${bsSoalOptionsHtml(s)}
                    <div class="bs-soal-key"><b>Kunci Jawaban:</b> <span class="${isPg ? 'is-key' : ''}">${bsEsc(key || '-')}</span></div>
                </div>
            </div>
            <div class="bs-soal-actions">
                <button type="button" title="Lihat soal lengkap" onclick="bsExpandRow(this)"><i class="fas fa-expand"></i></button>
                <button type="button" title="Edit soal" onclick="editSatuSoal(${Number(s.id)})"><i class="fas fa-pen"></i></button>
                <button type="button" title="Pindahkan ke folder" onclick="bsPindahkanSoal([${Number(s.id)}])"><i class="fas fa-folder-tree"></i></button>
                <button type="button" class="danger" title="Hapus soal" onclick="bsHapusSoal(${Number(s.id)})"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>`;
}

function bsRenderFiles() {
    const el = document.getElementById('bs-file-list');
    const head = document.getElementById('bs-file-head');
    const empty = document.getElementById('bs-empty-state');
    const moreWrap = document.getElementById('bs-load-more-wrap');
    const countEl = document.getElementById('bs-file-count');
    if (!el) return;

    const inSearch = !!(bsState.search && bsState.searchSoal !== null);
    let rows = inSearch ? (bsState.searchSoal || []) : (bsState.soalByFolder[bsFKey(bsState.currentFolderId)] || []);
    const hasFolders = document.querySelectorAll('#bs-folder-grid .bs-folder-card').length > 0;

    if (!rows.length) {
        el.innerHTML = '';
        if (head) head.style.display = 'none';
        if (moreWrap) moreWrap.style.display = 'none';
        if (empty) {
            if (inSearch) {
                empty.innerHTML = `<i class="fas fa-magnifying-glass"></i><div>${hasFolders ? 'Tidak ada soal yang cocok. Folder di atas mungkin cocok.' : 'Tidak ada folder atau soal yang cocok dengan pencarian.'}</div>`;
            } else if (bsState.currentFolderId === null) {
                empty.innerHTML = `<i class="fas fa-folder-open"></i><div>${hasFolders ? 'Tidak ada soal di luar folder. Buka salah satu folder di atas untuk melihat isinya.' : 'Belum ada folder atau soal di sini.'}</div>
                    <div class="bs-empty-actions">
                        <button type="button" class="btn btn-outline" onclick="bsBuatFolder()"><i class="fas fa-folder-plus"></i> Buat Folder</button>
                        <button type="button" class="btn btn-outline" onclick="bsScrollToUpload()"><i class="fas fa-file-import"></i> Upload Soal</button>
                    </div>`;
            } else {
                empty.innerHTML = `<i class="fas fa-inbox"></i><div>Folder ini masih kosong.</div>
                    <div class="bs-empty-actions">
                        <button type="button" class="btn btn-outline" onclick="bsBuatFolder()"><i class="fas fa-folder-plus"></i> Subfolder Baru</button>
                        <button type="button" class="btn btn-outline" onclick="bsScrollToUpload()"><i class="fas fa-file-import"></i> Upload Soal</button>
                    </div>`;
            }
            empty.style.display = 'block';
        }
        if (countEl) countEl.textContent = '';
        const prevBtn = document.getElementById('bs-btn-mapel-preview');
        if (prevBtn) prevBtn.style.display = 'none';
        bsSyncSelection();
        return;
    }
    if (empty) empty.style.display = 'none';

    const limit = inSearch ? rows.length : Math.min(rows.length, bsState.renderLimit);
    el.innerHTML = rows.slice(0, limit).map((s, i) => bsSoalHtml(s, i, inSearch)).join('');

    if (head) head.style.display = 'flex';
    if (countEl) {
        countEl.textContent = inSearch
            ? `${rows.length} hasil${rows.length >= 60 ? '+' : ''}`
            : `${rows.length} soal${bsState.currentFolderId === null ? ' tanpa folder' : ''}`;
    }
    if (moreWrap) moreWrap.style.display = (!inSearch && rows.length > limit) ? 'block' : 'none';

    // tombol preview mapel (ekspor/kisi-kisi) hanya jika folder berisi 1 mapel
    const mapelSet = new Set(rows.map(r => String(r.mapel || '').trim()).filter(Boolean));
    bsState.previewMapel = (!inSearch && mapelSet.size === 1) ? [...mapelSet][0] : null;
    const prevBtn = document.getElementById('bs-btn-mapel-preview');
    if (prevBtn) prevBtn.style.display = bsState.previewMapel ? 'inline-flex' : 'none';

    // restore checkbox terpilih
    el.querySelectorAll('.bs-cb-soal').forEach(cb => {
        cb.checked = bsState.selected.has(String(cb.value));
    });
    bsSyncSelection();
    bsTypeset(el);
}

function bsRender() {
    bsRenderBreadcrumb();
    const upRow = document.getElementById('bs-up-row');
    if (upRow) upRow.style.display = (bsState.currentFolderId !== null && !bsState.search) ? 'block' : 'none';
    bsRenderFolders();
    bsRenderFiles();
    const clearBtn = document.getElementById('bs-search-clear');
    if (clearBtn) clearBtn.style.display = bsState.search ? 'flex' : 'none';
}

// MathJax di admin dimuat lazy (loadMathJax di admin-soal.js). Explorer bisa
// tampil sebelum script itu selesai diunduh, jadi tunggu sekali lalu typeset.
function bsEnsureMathJax() {
    if (window.MathJax && typeof MathJax.typesetPromise === 'function') return Promise.resolve(true);
    if (bsState._mjPromise) return bsState._mjPromise;
    if (typeof loadMathJax !== 'function') return Promise.resolve(false);
    loadMathJax();
    bsState._mjPromise = new Promise((resolve) => {
        let tries = 0;
        const iv = setInterval(() => {
            tries++;
            if (window.MathJax && typeof MathJax.typesetPromise === 'function') {
                clearInterval(iv);
                resolve(true);
            } else if (tries > 50) {
                clearInterval(iv);
                bsState._mjPromise = null;
                resolve(false);
            }
        }, 300);
    });
    return bsState._mjPromise;
}

function bsTypeset(container) {
    if (!container) return;
    bsEnsureMathJax().then((ok) => {
        if (!ok) return;
        try { MathJax.typesetClear([container]); } catch (_) { /* noop */ }
        try { MathJax.typesetPromise([container]).catch(() => { }); } catch (_) { /* noop */ }
    });
}

function bsToggleSoalExpand(el) {
    if (!el) return;
    const row = el.closest('.bs-soal-row');
    if (!row) return;
    row.classList.toggle('is-open');
    if (row.classList.contains('is-open')) bsTypeset(row);
}

function bsExpandRow(btn) {
    const row = btn && btn.closest('.bs-soal-row');
    if (!row) return;
    row.classList.toggle('is-open');
    if (row.classList.contains('is-open')) bsTypeset(row);
}

// ---------- NAVIGASI ----------
async function bsBukaFolder(id) {
    bsState.currentFolderId = (id === null || id === undefined || id === '') ? null : Number(id);
    bsState.renderLimit = 40;
    bsState.search = '';
    bsState.searchSoal = null;
    bsState.searchFolders = [];
    const inp = document.getElementById('bs-search');
    if (inp) inp.value = '';
    const clearBtn = document.getElementById('bs-search-clear');
    if (clearBtn) clearBtn.style.display = 'none';

    const key = bsFKey(bsState.currentFolderId);
    if (!bsState.soalByFolder[key]) {
        const listEl = document.getElementById('bs-file-list');
        if (listEl) listEl.innerHTML = '<div class="bs-loading"><i class="fas fa-spinner fa-spin"></i> Membuka folder...</div>';
        const res = await bsLoadSoalFolder(bsState.currentFolderId);
        if (res.error) bsToast('Gagal membuka folder: ' + res.error.message, 'error');
    }
    bsState.selected.clear();
    bsRender();
    const panel = document.getElementById('panel-daftar-mapel');
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bsNaikFolder() {
    const cur = bsFindFolder(bsState.currentFolderId);
    bsBukaFolder(cur && cur.parent_id ? cur.parent_id : null);
}

function bsLoadMore() {
    bsState.renderLimit += 40;
    bsRenderFiles();
}

function bsScrollToUpload() {
    const area = document.querySelector('#bank-soal .upload-area');
    const panel = area ? area.closest('.card-panel') : null;
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bsPreviewMapelFolder() {
    if (bsState.previewMapel) bukaDetailSoal(bsState.previewMapel);
}

// ---------- PENCARIAN ----------
function bsClearSearch() {
    bsState.search = '';
    bsState.searchSoal = null;
    bsState.searchFolders = [];
    const inp = document.getElementById('bs-search');
    if (inp) inp.value = '';
    bsRender();
}

async function bsOnSearch() {
    const inp = document.getElementById('bs-search');
    const q = inp ? inp.value.trim() : '';
    bsState.search = q;
    const clearBtn = document.getElementById('bs-search-clear');
    if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';
    if (!q) {
        bsState.searchSoal = null;
        bsState.searchFolders = [];
        bsRender();
        return;
    }
    const token = ++bsState.searchToken;
    const listEl = document.getElementById('bs-file-list');
    if (listEl) listEl.innerHTML = '<div class="bs-loading"><i class="fas fa-spinner fa-spin"></i> Mencari...</div>';

    const lower = q.toLowerCase();
    const searchFolders = bsState.folders
        .filter(f => String(f.nama).toLowerCase().includes(lower) || bsFolderPath(f.id).toLowerCase().includes(lower))
        .sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'));

    const isAdmin = bsIsAdmin();
    const gid = bsGuruId();
    const cols = 'id, mapel, tipe_soal, pertanyaan, opsi_a, opsi_b, opsi_c, opsi_d, opsi_e, kunci_jawaban, folder_id, created_by';
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    const [r1, r2] = await Promise.all([
        (() => { let x = db.from('bank_soal').select(cols).ilike('pertanyaan', like).order('id', { ascending: false }).limit(60); if (!isAdmin && gid) x = x.eq('created_by', gid); return x; })(),
        (() => { let x = db.from('bank_soal').select(cols).ilike('mapel', like).order('id', { ascending: false }).limit(60); if (!isAdmin && gid) x = x.eq('created_by', gid); return x; })()
    ]);
    if (token !== bsState.searchToken) return;
    if (r1.error && r2.error) {
        if (listEl) listEl.innerHTML = `<div class="bs-error"><i class="fas fa-exclamation-circle"></i> Gagal mencari: ${bsEsc(r1.error.message)}</div>`;
        return;
    }
    const map = new Map();
    [...(r1.data || []), ...(r2.data || [])].forEach(s => { if (!map.has(s.id)) map.set(s.id, s); });
    bsState.searchSoal = [...map.values()].sort((a, b) => b.id - a.id);
    bsState.searchFolders = searchFolders;
    bsRender();
}

// ---------- SELEKSI ----------
function bsSyncSelection() {
    const cbs = document.querySelectorAll('#bs-file-list .bs-cb-soal');
    const checked = [];
    cbs.forEach(cb => { if (cb.checked) checked.push(String(cb.value)); });
    bsState.selected = new Set(checked);

    const bar = document.getElementById('bs-selection-bar');
    const countEl = document.getElementById('bs-selection-count');
    if (bar) bar.style.display = checked.length ? 'flex' : 'none';
    if (countEl) countEl.textContent = `${checked.length} soal dipilih`;

    const all = document.getElementById('select-all-soal');
    if (all) {
        all.checked = cbs.length > 0 && checked.length === cbs.length;
        all.indeterminate = checked.length > 0 && checked.length < cbs.length;
    }
}

function bsClearSelection() {
    bsState.selected.clear();
    document.querySelectorAll('#bs-file-list .bs-cb-soal').forEach(cb => { cb.checked = false; });
    bsSyncSelection();
}

// ---------- CRUD FOLDER ----------
async function bsCreateFolder(nama, parentId) {
    nama = String(nama || '').trim();
    if (!nama) { bsToast('Nama folder tidak boleh kosong', 'error'); return null; }
    if (nama.length > 60) { bsToast('Nama folder maksimal 60 karakter', 'error'); return null; }
    const parent = (parentId === null || parentId === undefined || parentId === '') ? null : Number(parentId);

    if (parent !== null && bsFolderDepth(parent) >= BS_MAX_DEPTH) {
        bsToast(`Maksimal ${BS_MAX_DEPTH} tingkat folder`, 'error');
        return null;
    }
    const dup = bsChildren(parent).find(f => String(f.nama).toLowerCase() === nama.toLowerCase());
    if (dup) { bsToast('Sudah ada folder dengan nama itu di lokasi ini', 'warning'); return null; }

    const { error } = await adminDb.insert('bank_soal_folder', [{ nama, parent_id: parent }]);
    if (error) { bsToast('Gagal membuat folder: ' + (error.message || error), 'error'); return null; }

    const gid = bsGuruId();
    let q = db.from('bank_soal_folder').select('*').eq('nama', nama).eq('created_by', gid);
    q = parent === null ? q.is('parent_id', null) : q.eq('parent_id', parent);
    const { data } = await q.order('id', { ascending: false }).limit(1);
    const folder = (data && data[0]) ? data[0] : null;
    await bsLoadFolders();
    return folder;
}

async function bsBuatFolder() {
    const parent = bsState.currentFolderId;
    if (parent !== null && bsFolderDepth(parent) >= BS_MAX_DEPTH) {
        return bsToast(`Maksimal ${BS_MAX_DEPTH} tingkat folder. Buat folder di lokasi yang lebih atas.`, 'error');
    }
    const lokasi = parent ? bsFolderPath(parent) : 'Bank Soal';
    const res = await Swal.fire({
        title: 'Folder Baru',
        html: `<div class="bs-swal-hint">Dibuat di: <b>${bsEsc(lokasi)}</b></div>`,
        input: 'text',
        inputPlaceholder: 'Contoh: Kelas X, BAB 1, UTS Ganjil',
        inputAttributes: { maxlength: 60 },
        showCancelButton: true,
        confirmButtonText: 'Buat Folder',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#3b82f6',
        background: 'rgba(15,23,42,0.98)',
        color: '#f1f5f9',
        inputValidator: (v) => {
            const t = String(v || '').trim();
            if (!t) return 'Nama folder wajib diisi';
            if (t.length > 60) return 'Maksimal 60 karakter';
            const dup = bsChildren(parent).find(f => String(f.nama).toLowerCase() === t.toLowerCase());
            if (dup) return 'Sudah ada folder dengan nama itu di sini';
        }
    });
    if (res.isDismissed || !res.value) return;
    const folder = await bsCreateFolder(res.value, parent);
    if (folder) {
        bsToast(`Folder "${folder.nama}" dibuat`, 'success');
        bsState.soalByFolder = {};
        await bsRefreshExplorer();
    }
}

async function bsRenameFolder(id) {
    const f = bsFindFolder(id);
    if (!f) return;
    const res = await Swal.fire({
        title: 'Rename Folder',
        input: 'text',
        inputValue: f.nama,
        inputAttributes: { maxlength: 60 },
        showCancelButton: true,
        confirmButtonText: 'Simpan',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#3b82f6',
        background: 'rgba(15,23,42,0.98)',
        color: '#f1f5f9',
        inputValidator: (v) => {
            const t = String(v || '').trim();
            if (!t) return 'Nama folder wajib diisi';
            if (t === f.nama) return 'Nama belum berubah';
            if (t.length > 60) return 'Maksimal 60 karakter';
            const dup = bsChildren(f.parent_id).find(x => String(x.id) !== String(f.id) && String(x.nama).toLowerCase() === t.toLowerCase());
            if (dup) return 'Sudah ada folder dengan nama itu di sini';
        }
    });
    if (res.isDismissed || !res.value) return;
    const nama = String(res.value).trim();
    const { error } = await adminDb.update('bank_soal_folder', f.id, { nama });
    if (error) return bsToast('Gagal rename folder: ' + (error.message || error), 'error');
    bsToast('Folder di-rename', 'success');
    await bsRefreshExplorer();
}

async function bsPindahkanFolder(id) {
    const f = bsFindFolder(id);
    if (!f) return;
    const exclude = bsCollectSubtree(id).map(String);
    const pick = await bsPickFolder({
        title: 'Pindahkan Folder',
        confirmText: 'Pindahkan ke sini',
        defaultFolderId: f.parent_id || null,
        excludeIds: exclude,
        allowRoot: true
    });
    if (!pick) return;
    const dest = pick.folderId === null ? null : Number(pick.folderId);
    if (dest !== null && bsIsDescendant(dest, id)) {
        return bsToast('Folder tidak bisa dipindah ke dalam subfoldernya sendiri', 'error');
    }
    const newDepth = (dest === null ? 0 : bsFolderDepth(dest)) + bsSubtreeHeight(id);
    if (newDepth > BS_MAX_DEPTH) {
        return bsToast(`Maksimal ${BS_MAX_DEPTH} tingkat folder (tujuan ini membuat ${newDepth} tingkat)`, 'error');
    }
    const { error } = await adminDb.update('bank_soal_folder', id, { parent_id: dest });
    if (error) return bsToast('Gagal memindahkan folder: ' + (error.message || error), 'error');
    bsToast(`Folder "${f.nama}" dipindahkan`, 'success');
    await bsRefreshExplorer();
}

// ---------- HAPUS FOLDER ----------
let _bsDeleteChoice = null;

async function bsHapusFolder(id) {
    const f = bsFindFolder(id);
    if (!f) return;
    const directSoal = bsState.counts[bsFKey(id)] || 0;
    const subfolders = bsChildren(id);
    const totalSoal = bsFolderTotalSoal(id);

    if (!directSoal && !subfolders.length) {
        const ok = (typeof asyncConfirm === 'function')
            ? await asyncConfirm(`Hapus folder kosong <b>"${bsEsc(f.nama)}"</b>?`, 'Hapus Folder?')
            : true;
        if (!ok) return;
        const { error } = await adminDb.delete('bank_soal_folder', id);
        if (error) return bsToast('Gagal menghapus folder: ' + (error.message || error), 'error');
        if (String(bsState.currentFolderId) === String(id)) bsState.currentFolderId = null;
        bsToast('Folder dihapus', 'success');
        return bsRefreshExplorer();
    }

    const subCount = (function countAll(folderId) {
        let n = 0;
        bsChildren(folderId).forEach(ch => { n += 1 + countAll(ch.id); });
        return n;
    })(id);

    _bsDeleteChoice = null;
    await Swal.fire({
        title: 'Hapus Folder?',
        html: `<div class="bs-del-box">
            <div class="bs-del-folder"><i class="fas fa-folder"></i> ${bsEsc(f.nama)}</div>
            <div class="bs-del-info">Folder ini berisi <b>${totalSoal} soal</b>${subCount ? ` dan <b>${subCount} subfolder</b>` : ''}.</div>
            <div class="bs-del-actions">
                <button type="button" class="bs-del-btn safe" onclick="_bsDeleteChoose('moveup')">
                    <i class="fas fa-arrow-up-from-bracket"></i>
                    <span><b>Pindahkan isi ke induk lalu hapus</b><small>Soal &amp; subfolder dipindah ke folder di atasnya</small></span>
                </button>
                <button type="button" class="bs-del-btn danger" onclick="_bsDeleteChoose('all')">
                    <i class="fas fa-trash-alt"></i>
                    <span><b>Hapus folder beserta semua isinya</b><small>${totalSoal} soal ikut terhapus permanen</small></span>
                </button>
            </div>
            <div class="bs-del-note">Atau tekan <b>Batal</b> untuk membatalkan.</div>
        </div>`,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText: 'Batal',
        background: 'rgba(15,23,42,0.98)',
        color: '#f1f5f9',
        allowOutsideClick: false,
        width: 560
    });

    const choice = _bsDeleteChoice;
    _bsDeleteChoice = null;
    if (!choice) return;

    if (choice === 'moveup') await bsDeleteFolderMoveUp(f);
    else if (choice === 'all') await bsDeleteFolderWithContent(f);
}

window._bsDeleteChoose = function (choice) {
    _bsDeleteChoice = choice;
    try { Swal.close(); } catch (_) { }
};

async function bsDeleteFolderMoveUp(f) {
    bsLoading(true, 'Memindahkan isi folder...');
    try {
        const parent = f.parent_id || null;
        const sRes = await adminDb.updateWhere('bank_soal', { folder_id: f.id }, { folder_id: parent }, { silent: true });
        if (sRes && sRes.error) throw sRes.error;
        const fRes = await adminDb.updateWhere('bank_soal_folder', { parent_id: f.id }, { parent_id: parent }, { silent: true });
        if (fRes && fRes.error) throw fRes.error;
        const dRes = await adminDb.delete('bank_soal_folder', f.id);
        if (dRes && dRes.error) throw dRes.error;
        if (String(bsState.currentFolderId) === String(f.id)) bsState.currentFolderId = parent;
        bsToast(`Isi folder "${f.nama}" dipindah ke ${parent ? 'induknya' : 'Bank Soal'}, folder dihapus`, 'success');
    } catch (e) {
        bsToast('Gagal menghapus folder: ' + (e && e.message ? e.message : e), 'error');
    } finally {
        bsLoading(false);
    }
    await bsRefreshExplorer();
}

async function bsDeleteFolderWithContent(f) {
    const confirm = await Swal.fire({
        title: 'Yakin hapus semua?',
        html: `<div class="bs-swal-hint">Semua soal dan subfolder di dalam <b>${bsEsc(f.nama)}</b> akan <b style="color:#f87171;">dihapus permanen</b>. Tindakan ini tidak bisa dibatalkan.</div>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Ya, hapus semua',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#ef4444',
        background: 'rgba(15,23,42,0.98)',
        color: '#f1f5f9'
    });
    if (!confirm.isConfirmed) return;

    bsLoading(true, 'Menghapus folder & isinya...');
    try {
        const folderIds = bsCollectSubtree(f.id);
        const soalIds = await bsFetchSoalIdsInFolders(folderIds);
        if (soalIds.length) {
            const bd = await adminDb.batchDelete('bank_soal', soalIds, { silent: true });
            if (bd && bd.error) throw bd.error;
        }
        const bf = await adminDb.batchDelete('bank_soal_folder', folderIds, { silent: true });
        if (bf && bf.error) throw bf.error;
        if (folderIds.some(x => String(x) === String(bsState.currentFolderId))) bsState.currentFolderId = null;
        bsToast(`Folder "${f.nama}" dan ${soalIds.length} soal dihapus`, 'success');
    } catch (e) {
        bsToast('Gagal menghapus: ' + (e && e.message ? e.message : e), 'error');
    } finally {
        bsLoading(false);
    }
    await bsRefreshExplorer();
}

async function bsFetchSoalIdsInFolders(folderIds) {
    const ids = folderIds.map(Number).filter(n => !isNaN(n));
    if (!ids.length) return [];
    const PAGE = 1000;
    let out = [];
    let from = 0;
    while (true) {
        const { data, error } = await db.from('bank_soal').select('id').in('folder_id', ids).order('id', { ascending: true }).range(from, from + PAGE - 1);
        if (error) break;
        if (!data || !data.length) break;
        out = out.concat(data.map(r => r.id));
        if (data.length < PAGE) break;
        from += PAGE;
        if (from > 40000) break;
    }
    return out;
}

function bsFolderMenu(id, ev) {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    const f = bsFindFolder(id);
    if (!f) return;
    Swal.fire({
        title: bsEsc(f.nama),
        html: `<div class="bs-menu-list">
            <button type="button" onclick="_bsMenuAction('open', ${Number(id)})"><i class="fas fa-folder-open"></i> Buka folder</button>
            <button type="button" onclick="_bsMenuAction('rename', ${Number(id)})"><i class="fas fa-pen"></i> Rename</button>
            <button type="button" onclick="_bsMenuAction('move', ${Number(id)})"><i class="fas fa-folder-tree"></i> Pindahkan folder</button>
            <button type="button" class="danger" onclick="_bsMenuAction('delete', ${Number(id)})"><i class="fas fa-trash-alt"></i> Hapus folder</button>
        </div>`,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText: 'Tutup',
        background: 'rgba(15,23,42,0.98)',
        color: '#f1f5f9',
        width: 420
    });
}

window._bsMenuAction = function (action, id) {
    try { Swal.close(); } catch (_) { }
    setTimeout(() => {
        if (action === 'open') bsBukaFolder(id);
        else if (action === 'rename') bsRenameFolder(id);
        else if (action === 'move') bsPindahkanFolder(id);
        else if (action === 'delete') bsHapusFolder(id);
    }, 150);
};

// ---------- SOAL ----------
async function bsHapusSoal(id) {
    const ok = (typeof asyncConfirm === 'function')
        ? await asyncConfirm('Hapus soal ini secara permanen?', 'Hapus Soal?')
        : true;
    if (!ok) return;
    const { data: backup } = await db.from('bank_soal').select('*').eq('id', id).single();
    const { error } = await adminDb.delete('bank_soal', id);
    if (error) return bsToast('Gagal menghapus: ' + (error.message || error), 'error');
    const undo = async () => {
        if (!backup) return;
        const { error: insErr } = await adminDb.insert('bank_soal', [backup]);
        if (insErr) bsToast('Gagal membatalkan: ' + insErr.message, 'error');
        else { bsToast('Soal dipulihkan', 'success'); bsRefreshExplorer(); }
    };
    bsToast('Soal dihapus', 'success', undo, 'Batalkan');
    bsState.soalByFolder = {};
    await bsRefreshExplorer();
}

async function bsHapusSoalTerpilih() {
    const ids = [...bsState.selected].map(Number).filter(n => !isNaN(n));
    if (!ids.length) return bsToast('Pilih minimal satu soal', 'info');
    const ok = (typeof asyncConfirm === 'function')
        ? await asyncConfirm(`Hapus <b>${ids.length} soal</b> terpilih secara permanen?`, 'Hapus Soal?')
        : true;
    if (!ok) return;
    const { data: backup } = await db.from('bank_soal').select('*').in('id', ids);
    const { error } = await adminDb.batchDelete('bank_soal', ids);
    if (error) return bsToast('Gagal menghapus: ' + (error.message || error), 'error');
    const undo = async () => {
        if (backup && backup.length) {
            await chunkedInsert('bank_soal', backup);
            bsRefreshExplorer();
            bsToast(`${ids.length} soal dipulihkan`, 'success');
        }
    };
    bsToast(`${ids.length} soal dihapus`, 'success', undo, 'Undo');
    bsState.soalByFolder = {};
    await bsRefreshExplorer();
}

async function bsPindahkanSoalTerpilih() {
    const ids = [...bsState.selected].map(Number).filter(n => !isNaN(n));
    if (!ids.length) return bsToast('Pilih minimal satu soal', 'info');
    await bsPindahkanSoal(ids);
}

async function bsPindahkanSoal(ids) {
    ids = (ids || []).map(Number).filter(n => !isNaN(n));
    if (!ids.length) return;
    const pick = await bsPickFolder({
        title: ids.length > 1 ? `Pindahkan ${ids.length} soal` : 'Pindahkan soal',
        confirmText: 'Pindahkan ke sini',
        defaultFolderId: bsState.currentFolderId,
        allowRoot: true
    });
    if (!pick) return;
    const dest = pick.folderId === null ? null : Number(pick.folderId);
    bsLoading(true, `Memindahkan ${ids.length} soal...`);
    let lastErr = null;
    try {
        for (const id of ids) {
            const { error } = await adminDb.update('bank_soal', id, { folder_id: dest }, { silent: true });
            if (error) lastErr = error;
        }
    } finally {
        bsLoading(false);
    }
    if (lastErr) return bsToast('Sebagian gagal dipindahkan: ' + (lastErr.message || lastErr), 'error');
    bsToast(`${ids.length} soal dipindahkan ke ${dest === null ? 'Bank Soal' : pick.folderPath}`, 'success');
    bsState.soalByFolder = {};
    bsState.selected.clear();
    await bsRefreshExplorer();
}

// ---------- PEMILIH FOLDER ----------
const bsPickState = { selectedId: null, newName: '', exclude: new Set(), allowRoot: true };

function bsFlattenFolders(parentId, depth, out, exclude) {
    bsChildren(parentId).forEach(f => {
        if (exclude.has(String(f.id))) return;
        out.push({ f, depth });
        bsFlattenFolders(f.id, depth + 1, out, exclude);
    });
    return out;
}

function bsPickRowsHtml() {
    const rows = bsFlattenFolders(null, 0, [], bsPickState.exclude);
    let html = '';
    if (bsPickState.allowRoot !== false) {
        html += `<button type="button" class="bs-pick-row ${bsPickState.selectedId === null ? 'is-selected' : ''}"
            data-id="" data-name="bank soal tanpa folder root" onclick="bsPickSelect('')">
            <i class="fas fa-inbox"></i><span class="bs-pick-name">Bank Soal (tanpa folder)</span>
            <i class="fas fa-check bs-pick-check"></i>
        </button>`;
    }
    if (!rows.length) {
        html += `<div class="bs-pick-empty">Belum ada folder. Buat folder baru di bawah.</div>`;
    }
    rows.forEach(({ f, depth }) => {
        const path = bsFolderPath(f.id);
        html += `<button type="button" class="bs-pick-row ${String(bsPickState.selectedId) === String(f.id) ? 'is-selected' : ''}"
            data-id="${Number(f.id)}" data-name="${bsEsc((f.nama + ' ' + path).toLowerCase())}"
            style="padding-left:${14 + depth * 18}px"
            onclick="bsPickSelect(${Number(f.id)})">
            <i class="fas fa-folder"></i>
            <span class="bs-pick-name" title="${bsEsc(path)}">${bsEsc(f.nama)}</span>
            <span class="bs-pick-path">${depth > 0 ? bsEsc(path) : ''}</span>
            <i class="fas fa-check bs-pick-check"></i>
        </button>`;
    });
    return html;
}

window.bsPickSelect = function (id) {
    bsPickState.selectedId = (id === '' || id === null || id === undefined) ? null : Number(id);
    const list = document.getElementById('bs-pick-list');
    if (!list) return;
    list.querySelectorAll('.bs-pick-row').forEach(row => {
        const rid = row.getAttribute('data-id');
        const match = (rid === '' && bsPickState.selectedId === null) || (rid !== '' && String(rid) === String(bsPickState.selectedId));
        row.classList.toggle('is-selected', match);
    });
    const hint = document.getElementById('bs-pick-target');
    if (hint) {
        const path = bsPickState.selectedId === null ? 'Bank Soal' : bsFolderPath(bsPickState.selectedId);
        hint.innerHTML = `Folder baru akan dibuat di: <b>${bsEsc(path)}</b>`;
    }
};

window.bsPickFilter = function (q) {
    const list = document.getElementById('bs-pick-list');
    if (!list) return;
    const lower = String(q || '').toLowerCase().trim();
    list.querySelectorAll('.bs-pick-row').forEach(row => {
        const name = row.getAttribute('data-name') || '';
        row.style.display = (!lower || name.includes(lower)) ? '' : 'none';
    });
};

async function bsPickFolder(opts) {
    opts = opts || {};
    const sesi = (typeof getGuruSession === 'function') ? getGuruSession() : null;
    if (!sesi) { bsToast('Sesi tidak valid, silakan login ulang', 'error'); return null; }

    await bsLoadFolders();

    const exclude = new Set((opts.excludeIds || []).map(String));
    bsPickState.exclude = exclude;
    bsPickState.allowRoot = opts.allowRoot !== false;

    let defaultId = (opts.defaultFolderId !== undefined) ? opts.defaultFolderId : bsState.currentFolderId;
    if (defaultId !== null && defaultId !== undefined && !bsFindFolder(defaultId)) defaultId = null;
    if (defaultId !== null && defaultId !== undefined && exclude.has(String(defaultId))) defaultId = null;

    let prefillName = '';
    const suggested = String(opts.suggestedName || '').trim();
    if (suggested) {
        const match = bsState.folders.find(f => !f.parent_id && String(f.nama).toLowerCase() === suggested.toLowerCase() && !exclude.has(String(f.id)));
        const atRoot = (defaultId === null || defaultId === undefined);
        if (match && atRoot) {
            // di root + folder mapel sudah ada → langsung pilih folder mapel itu
            defaultId = match.id;
        } else if (!match && atRoot) {
            // di root + folder mapel belum ada → tawarkan buat folder mapel
            prefillName = suggested;
        }
        // jika guru sedang di dalam sebuah folder, folder aktif tetap jadi default
    }
    bsPickState.selectedId = (defaultId === null || defaultId === undefined) ? null : Number(defaultId);
    bsPickState.newName = prefillName;

    const html = `<div class="bs-pick">
        <div class="bs-pick-search">
            <i class="fas fa-search"></i>
            <input id="bs-pick-search-input" class="form-control" placeholder="Cari folder..." autocomplete="off"
                oninput="bsPickFilter(this.value)">
        </div>
        <div class="bs-pick-list" id="bs-pick-list">
            ${bsPickRowsHtml()}
        </div>
        <div class="bs-pick-new">
            <div class="bs-pick-new-title"><i class="fas fa-folder-plus"></i> Folder baru (opsional)</div>
            <div class="bs-pick-new-row">
                <input id="bs-pick-new-name" class="form-control" maxlength="60" placeholder="Nama folder baru..."
                    value="${bsEsc(prefillName)}" onkeydown="if(event.key==='Enter'){event.preventDefault();Swal.clickConfirm();}">
            </div>
            <div class="bs-pick-target" id="bs-pick-target">Folder baru akan dibuat di: <b>${bsEsc(bsFolderPath(bsPickState.selectedId))}</b></div>
        </div>
    </div>`;

    const res = await Swal.fire({
        title: opts.title || 'Pilih Folder',
        html,
        width: 560,
        background: 'rgba(15,23,42,0.98)',
        color: '#f1f5f9',
        showCancelButton: true,
        confirmButtonText: opts.confirmText || 'Simpan di folder ini',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#3b82f6',
        focusConfirm: false,
        didOpen: () => {
            const inp = document.getElementById('bs-pick-new-name');
            if (inp && prefillName) {
                setTimeout(() => inp.focus(), 120);
            }
        },
        preConfirm: async () => {
            const nameInp = document.getElementById('bs-pick-new-name');
            const newName = nameInp ? String(nameInp.value || '').trim() : '';
            if (newName) {
                const created = await bsCreateFolder(newName, bsPickState.selectedId);
                if (!created) {
                    try { Swal.showValidationMessage('Gagal membuat folder. Coba nama lain.'); } catch (_) { }
                    return false;
                }
                return { folderId: Number(created.id), folderPath: bsFolderPath(created.id) };
            }
            const fid = bsPickState.selectedId;
            return { folderId: fid === null ? null : Number(fid), folderPath: fid === null ? 'Bank Soal' : bsFolderPath(fid) };
        }
    });

    if (!res.isConfirmed || !res.value) return null;
    return res.value;
}

// ---------- EKSPOR / LAIN ----------
async function bsRefreshAfterSoalChange() {
    bsState.soalByFolder = {};
    await bsRefreshExplorer();
}
