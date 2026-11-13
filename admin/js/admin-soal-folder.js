// @ts-nocheck
// ============================================================
// admin-soal-folder.js — Bank Soal sebagai daftar MAPEL
//
// Model:
//   - Daftar Bank Soal berisi MAPEL. Tiap mapel bisa dipindah ke folder
//     mana pun (maks 3 tingkat folder), di-rename, dihapus, dan dicari.
//   - Folder hanya pengelompokan (tidak berisi soal langsung).
//   - Soal TIDAK dikelola di sini. Klik sebuah mapel -> panel "Preview Soal"
//     (bukaDetailSoal) tempat edit / ubah mapel / hapus soal.
//   - Mode "Pilih banyak": tombol di toolbar. Selama mode ini aktif, kotak centang
//     muncul di tiap mapel, klik kartu = memilih (BUKAN membuka Preview Soal),
//     dan mapel terpilih bisa dipindah bersama ke satu folder.
//
// Tabel: bank_soal_folder
//   mapel IS NULL      -> folder grup
//   mapel IS NOT NULL  -> entri mapel (daun, tidak boleh diberi subfolder)
//   Lokasi soal selalu mengikuti `bank_soal.mapel` (tanpa folder_id).
// ============================================================

const BS_MAX_DEPTH = 3;

const bsState = {
    nodes: [],            // semua baris bank_soal_folder (folder grup + entri mapel)
    counts: {},           // lower(mapel) -> { total, pg, essay }
    currentFolderId: null,
    search: '',
    searchResult: null,   // null = bukan mode cari
    selectMode: false,    // true = mode pilih banyak (klik mapel = memilih, bukan buka preview)
    selected: new Set(),  // id (string) entri mapel yang dipilih untuk dipindah massal
    _bound: false,
    _loading: null,
    _loaded: false,
    _searchTimer: null
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
function bsSameParent(a, b) {
    const na = (a === null || a === undefined || a === '') ? null : String(a);
    const nb = (b === null || b === undefined || b === '') ? null : String(b);
    return na === nb;
}
function bsLoading(on, msg) {
    try {
        if (on) {
            if (typeof showGlobalLoader === 'function') showGlobalLoader(msg || 'Memproses...', { immediate: true });
        } else if (typeof hideGlobalLoader === 'function') hideGlobalLoader();
    } catch (_) { /* noop */ }
}
function bsToast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'success');
    else if (window.Swal) Swal.fire({ icon: type === 'error' ? 'error' : 'success', title: msg });
}
function bsSwal(opts) {
    return Swal.fire(Object.assign({
        background: 'rgba(15,23,42,0.98)',
        color: '#f1f5f9'
    }, opts));
}

// ---------- DATA ----------
async function bsLoadFolders(force) {
    if (bsState._loaded && !force) return { error: null };
    const isAdmin = bsIsAdmin();
    const gid = bsGuruId();
    const PAGE = 1000;
    let all = [];
    let from = 0;
    while (true) {
        let q = db.from('bank_soal_folder')
            .select('id, nama, parent_id, mapel, created_by, created_at')
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
        if (!isAdmin && gid) q = q.eq('created_by', gid);
        const { data, error } = await q;
        if (error) return { error };
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
        if (from > 20000) break;
    }
    bsState.nodes = all;
    bsState._loaded = true;
    return { error: null };
}

async function bsLoadIndex() {
    const isAdmin = bsIsAdmin();
    const gid = bsGuruId();
    const PAGE = 1000;
    let all = [];
    let from = 0;
    while (true) {
        let q = db.from('bank_soal')
            .select('mapel, tipe_soal')
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
        if (!isAdmin && gid) q = q.eq('created_by', gid);
        const { data, error } = await q;
        if (error) return { error };
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
        if (from > 40000) break;
    }
    const counts = {};
    all.forEach(r => {
        const k = String(r.mapel || '').trim().toLowerCase();
        if (!k) return;
        const c = counts[k] || (counts[k] = { total: 0, pg: 0, essay: 0 });
        c.total++;
        if (String(r.tipe_soal || '').toUpperCase() === 'ESSAY') c.essay++;
        else c.pg++;
    });
    bsState.counts = counts;
    return { error: null };
}

function bsFindNode(id) {
    if (id === null || id === undefined || id === '') return null;
    return bsState.nodes.find(n => String(n.id) === String(id)) || null;
}
function bsChain(id) {
    const chain = [];
    let cur = bsFindNode(id);
    let guard = 0;
    while (cur && guard < 20) {
        chain.unshift(cur);
        cur = cur.parent_id ? bsFindNode(cur.parent_id) : null;
        guard++;
    }
    return chain;
}
function bsPath(id) {
    if (id === null || id === undefined || id === '') return 'Bank Soal';
    const chain = bsChain(id);
    return chain.length ? chain.map(n => n.nama).join(' / ') : 'Bank Soal';
}
function bsFolderDepth(id) {
    let d = 0;
    let cur = bsFindNode(id);
    let guard = 0;
    while (cur && guard < 20) {
        if (!cur.mapel) d++;
        cur = cur.parent_id ? bsFindNode(cur.parent_id) : null;
        guard++;
    }
    return d;
}
function bsChildrenFolders(parentId) {
    return bsState.nodes
        .filter(n => !n.mapel && bsSameParent(n.parent_id, parentId))
        .sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'));
}
function bsChildrenMapels(parentId) {
    return bsState.nodes
        .filter(n => !!n.mapel && bsSameParent(n.parent_id, parentId))
        .sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'));
}
function bsSubtreeFolderHeight(id) {
    const kids = bsChildrenFolders(id);
    if (!kids.length) return 1;
    return 1 + Math.max(...kids.map(k => bsSubtreeFolderHeight(k.id)));
}
function bsCollectSubtreeIds(id) {
    const out = [];
    (function walk(nodeId) {
        if (out.some(x => String(x) === String(nodeId))) return;
        out.push(nodeId);
        bsState.nodes.filter(n => bsSameParent(n.parent_id, nodeId))
            .forEach(n => walk(n.id));
    })(id);
    return out;
}
function bsMapelCount(mapel) {
    return bsState.counts[String(mapel || '').trim().toLowerCase()] || { total: 0, pg: 0, essay: 0 };
}
function bsFolderTotals(id) {
    let folders = 0, mapels = 0, soal = 0;
    bsState.nodes.filter(n => bsSameParent(n.parent_id, id)).forEach(n => {
        if (n.mapel) {
            mapels++;
            soal += bsMapelCount(n.mapel).total;
        } else {
            const t = bsFolderTotals(n.id);
            folders += 1 + t.folders;
            mapels += t.mapels;
            soal += t.soal;
        }
    });
    return { folders, mapels, soal };
}
function bsMapelNodeFor(name) {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return null;
    const gid = bsGuruId();
    const isAdmin = bsIsAdmin();
    const hits = bsState.nodes.filter(n => n.mapel && String(n.mapel).trim().toLowerCase() === key)
        .filter(n => isAdmin || String(n.created_by) === String(gid));
    if (!hits.length) return null;
    // untuk admin: utamakan entri milik sendiri
    hits.sort((a, b) => (String(a.created_by) === String(gid) ? -1 : 0) - (String(b.created_by) === String(gid) ? -1 : 0));
    return hits[0];
}

// ---------- REFRESH + RENDER ----------
async function bsRefreshExplorer(opts) {
    opts = opts || {};
    const grid = document.getElementById('bs-folder-grid');
    if (!grid) return;

    bsBindUi();
    if (bsState._loading) return bsState._loading;

    if (!bsState.nodes.length) {
        grid.style.display = 'grid';
        grid.innerHTML = '<div class="bs-loading" style="grid-column:1/-1"><i class="fas fa-spinner fa-spin"></i> Memuat bank soal...</div>';
    }

    bsState._loading = (async () => {
        const fRes = await bsLoadFolders(true);
        if (fRes.error) return bsRenderError(fRes.error.message);
        const iRes = await bsLoadIndex();
        if (iRes.error) return bsRenderError(iRes.error.message);
        if (bsState.currentFolderId !== null && !bsFindNode(bsState.currentFolderId)) {
            bsState.currentFolderId = null;
            bsState.search = '';
            bsState.searchResult = null;
        }
        // buang centang yang mapelnya sudah tidak ada (terhapus / dipindah user lain)
        Array.from(bsState.selected).forEach(id => {
            const n = bsFindNode(id);
            if (!n || !n.mapel) bsState.selected.delete(id);
        });
        bsRender();
    })();

    try { await bsState._loading; } finally { bsState._loading = null; }
}

function bsRenderError(msg) {
    const grid = document.getElementById('bs-folder-grid');
    if (!grid) return;
    grid.style.display = 'block';
    grid.innerHTML = `<div class="bs-error"><i class="fas fa-exclamation-circle"></i> Gagal memuat bank soal: ${bsEsc(msg)}</div>`;
    const empty = document.getElementById('bs-empty-state');
    if (empty) empty.style.display = 'none';
}

function bsBindUi() {
    if (bsState._bound) return;
    const inp = document.getElementById('bs-search');
    if (!inp) return;
    inp.addEventListener('input', () => {
        clearTimeout(bsState._searchTimer);
        bsState._searchTimer = setTimeout(() => bsOnSearch(), 220);
    });
    inp.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { inp.value = ''; bsClearSearch(); }
    });
    bsState._bound = true;
}

function bsRender() {
    bsRenderBreadcrumb();
    const up = document.getElementById('bs-up-row');
    if (up) up.style.display = (!bsState.search && bsState.currentFolderId !== null) ? 'block' : 'none';
    bsRenderGrid();
    bsSyncSelectionUi();
    const clearBtn = document.getElementById('bs-search-clear');
    if (clearBtn) clearBtn.style.display = bsState.search ? 'flex' : 'none';
}

function bsRenderBreadcrumb() {
    const el = document.getElementById('bs-breadcrumb');
    if (!el) return;
    if (bsState.search) {
        el.innerHTML = `<span class="bs-crumb active"><i class="fas fa-magnifying-glass"></i> Hasil pencarian "${bsEsc(bsState.search)}"</span>`;
        return;
    }
    const chain = bsChain(bsState.currentFolderId);
    let html = `<button type="button" class="bs-crumb ${chain.length ? '' : 'active'}" onclick="bsBukaFolder(null)"><i class="fas fa-house"></i> Bank Soal</button>`;
    chain.forEach((n, i) => {
        html += '<i class="fas fa-chevron-right bs-crumb-sep"></i>';
        if (i === chain.length - 1) {
            html += `<span class="bs-crumb active" title="${bsEsc(n.nama)}">${bsEsc(n.nama)}</span>`;
        } else {
            html += `<button type="button" class="bs-crumb" onclick="bsBukaFolder(${Number(n.id)})" title="${bsEsc(n.nama)}">${bsEsc(n.nama)}</button>`;
        }
    });
    el.innerHTML = html;
}

function bsCardHtml(n, showPath) {
    const isMapel = !!n.mapel;
    let sub;
    if (isMapel) {
        const c = bsMapelCount(n.mapel);
        sub = c.total
            ? `${c.total} soal · ${c.pg} PG${c.essay ? ` · ${c.essay} essay` : ''}`
            : 'belum ada soal';
    } else {
        const t = bsFolderTotals(n.id);
        const bits = [`${t.mapels} mapel`];
        if (t.folders) bits.push(`${t.folders} subfolder`);
        bits.push(`${t.soal} soal`);
        sub = bits.join(' · ');
    }
    const path = showPath ? bsPath(n.parent_id) : '';
    const mode = bsState.selectMode;
    const checked = isMapel && bsState.selected.has(String(n.id));
    // Kotak centang & menu ⋮ hanya relevan di luar/dalam mode pilih banyak.
    const check = (isMapel && mode)
        ? `<input type="checkbox" class="bs-node-check" tabindex="-1" title="Pilih mapel ini"
                ${checked ? 'checked' : ''}
                onclick="event.stopPropagation();bsToggleSelect(${Number(n.id)})">`
        : '';
    const menu = mode
        ? ''
        : `<span class="bs-node-menu" role="button" tabindex="0" title="Aksi"
                onclick="event.stopPropagation();bsNodeMenu(${Number(n.id)})"
                onkeydown="event.stopPropagation();if(event.key==='Enter'){bsNodeMenu(${Number(n.id)});}">
                <i class="fas fa-ellipsis-vertical"></i>
            </span>`;
    const pickable = mode && isMapel;
    return `
        <div class="bs-node-card ${isMapel ? 'is-mapel' : 'is-folder'} ${checked ? 'is-selected' : ''} ${pickable ? 'is-pickable' : ''}"
            role="${pickable ? 'checkbox' : 'button'}" tabindex="0" data-id="${Number(n.id)}"
            ${pickable ? `aria-checked="${checked ? 'true' : 'false'}"` : ''}
            onclick="bsCardClick(event, ${Number(n.id)})"
            onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();bsCardClick(event, ${Number(n.id)});}">
            ${check}
            <span class="bs-node-icon"><i class="fas ${isMapel ? 'fa-book-open' : 'fa-folder'}"></i></span>
            <span class="bs-node-body">
                <span class="bs-node-name" title="${bsEsc(n.nama)}">${bsEsc(n.nama)}</span>
                <span class="bs-node-sub">${bsEsc(sub)}</span>
                ${path ? `<span class="bs-node-path" title="${bsEsc(path)}"><i class="fas fa-location-dot"></i> ${bsEsc(path)}</span>` : ''}
            </span>
            ${menu}
        </div>`;
}

function bsRenderGrid() {
    const grid = document.getElementById('bs-folder-grid');
    const empty = document.getElementById('bs-empty-state');
    if (!grid) return;

    let folders, mapels, showPath = false;
    if (bsState.search && bsState.searchResult) {
        folders = bsState.searchResult.folders;
        mapels = bsState.searchResult.mapels;
        showPath = true;
    } else {
        folders = bsChildrenFolders(bsState.currentFolderId);
        mapels = bsChildrenMapels(bsState.currentFolderId);
    }

    grid.style.display = 'grid';
    grid.classList.toggle('is-select-mode', !!bsState.selectMode);
    grid.innerHTML = folders.map(n => bsCardHtml(n, showPath)).join('')
        + mapels.map(n => bsCardHtml(n, showPath)).join('');

    const kosong = !folders.length && !mapels.length;
    if (empty) {
        empty.style.display = kosong ? 'block' : 'none';
        if (kosong) empty.innerHTML = bsEmptyHtml();
    }
}

function bsEmptyHtml() {
    if (bsState.search) {
        return `<i class="fas fa-magnifying-glass"></i><div>Tidak ada mapel atau folder yang cocok dengan "${bsEsc(bsState.search)}".</div>
            <div class="bs-empty-actions"><button type="button" class="btn btn-outline" onclick="bsClearSearch()"><i class="fas fa-times"></i> Hapus pencarian</button></div>`;
    }
    if (bsState.currentFolderId === null) {
        return `<i class="fas fa-folder-open"></i><div>Belum ada mapel di Bank Soal.</div>
            <div class="bs-empty-actions">
                <button type="button" class="btn btn-outline" onclick="bsBuatFolder()"><i class="fas fa-folder-plus"></i> Buat Folder</button>
                <button type="button" class="btn btn-outline" onclick="bsScrollToUpload()"><i class="fas fa-file-import"></i> Upload Soal</button>
            </div>`;
    }
    return `<i class="fas fa-inbox"></i><div>Folder ini masih kosong. Pindahkan mapel ke sini lewat menu ⋮ pada mapel.</div>
        <div class="bs-empty-actions">
            <button type="button" class="btn btn-outline" onclick="bsBuatFolder()"><i class="fas fa-folder-plus"></i> Subfolder Baru</button>
        </div>`;
}

// ---------- NAVIGASI ----------
function bsBukaFolder(id) {
    bsState.currentFolderId = (id === null || id === undefined || id === '') ? null : Number(id);
    bsState.search = '';
    bsState.searchResult = null;
    const inp = document.getElementById('bs-search');
    if (inp) inp.value = '';
    bsRender();
    const panel = document.getElementById('panel-daftar-mapel');
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bsBukaMapel(id) {
    const n = bsFindNode(id);
    if (!n || !n.mapel) return;
    if (typeof bukaDetailSoal === 'function') {
        bukaDetailSoal(n.mapel);
    } else {
        bsToast('Modul bank soal belum siap, muat ulang halaman', 'error');
    }
}

function bsBukaNode(id) {
    const n = bsFindNode(id);
    if (!n) return;
    n.mapel ? bsBukaMapel(id) : bsBukaFolder(id);
}

// Klik kartu:
//   - mode pilih banyak & kartu mapel -> memilih (tidak membuka Preview Soal)
//   - mode pilih banyak & kartu folder -> masuk folder (pilihan tetap tersimpan)
//   - Ctrl/Cmd/Shift+klik mapel     -> masuk mode pilih lalu memilih mapel itu
//   - klik biasa                    -> buka Preview Soal / folder
function bsCardClick(ev, id) {
    const n = bsFindNode(id);
    if (!n) return;
    if (!n.mapel) { bsBukaFolder(id); return; }
    if (bsState.selectMode) {
        if (ev && ev.preventDefault) ev.preventDefault();
        bsToggleSelect(id);
        return;
    }
    if (ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) {
        if (ev.preventDefault) ev.preventDefault();
        bsSetSelectMode(true);
        bsToggleSelect(id);
        bsToast('Mode pilih banyak aktif — klik mapel lain untuk memilih', 'info');
        return;
    }
    bsBukaMapel(id);
}

// ---------- MODE PILIH BANYAK ----------
function bsSetSelectMode(on) {
    const next = !!on;
    if (bsState.selectMode === next) return;
    bsState.selectMode = next;
    if (!next) bsState.selected.clear();
    bsRender();
}

function bsToggleSelectMode() {
    bsSetSelectMode(!bsState.selectMode);
}

function bsKeluarModePilih() {
    bsSetSelectMode(false);
}

// ---------- PILIH BANYAK MAPEL ----------
function bsSelectedIds() {
    return Array.from(bsState.selected);
}

function bsIsSelected(id) {
    return bsState.selected.has(String(id));
}

function bsToggleSelect(id) {
    const n = bsFindNode(id);
    if (!n || !n.mapel) return;
    if (!bsState.selectMode) bsSetSelectMode(true);
    const key = String(id);
    if (bsState.selected.has(key)) bsState.selected.delete(key);
    else bsState.selected.add(key);
    bsSyncSelectionUi();
}

function bsClearSelection() {
    bsState.selected.clear();
    bsSyncSelectionUi();
}

// Pilih / batalkan semua mapel yang tampil di layar sekarang (hasil cari atau isi folder).
function bsPilihSemuaMapel() {
    const cards = Array.from(document.querySelectorAll('#bs-folder-grid .bs-node-card.is-mapel'));
    if (!cards.length) return;
    if (!bsState.selectMode) bsSetSelectMode(true);
    const ids = cards.map(c => String(c.getAttribute('data-id')));
    const semuaTerpilih = ids.every(id => bsState.selected.has(id));
    ids.forEach(id => {
        if (semuaTerpilih) bsState.selected.delete(id);
        else bsState.selected.add(id);
    });
    bsSyncSelectionUi();
}

function bsSyncSelectionUi() {
    const cards = document.querySelectorAll('#bs-folder-grid .bs-node-card.is-mapel');
    cards.forEach(card => {
        const on = bsState.selected.has(String(card.getAttribute('data-id')));
        card.classList.toggle('is-selected', on);
        const cb = card.querySelector('.bs-node-check');
        if (cb) cb.checked = on;
        if (card.getAttribute('role') === 'checkbox') card.setAttribute('aria-checked', on ? 'true' : 'false');
        else card.removeAttribute('aria-checked');
    });

    const mode = !!bsState.selectMode;
    const n = bsState.selected.size;

    // Tombol toolbar: label + status aktif
    const modeBtn = document.getElementById('bs-btn-select-mode');
    if (modeBtn) {
        modeBtn.classList.toggle('is-active', mode);
        const lbl = modeBtn.querySelector('span');
        if (lbl) lbl.textContent = mode ? 'Selesai pilih' : 'Pilih banyak';
        modeBtn.title = mode
            ? 'Keluar dari mode pilih banyak'
            : 'Pilih beberapa mapel sekaligus untuk dipindahkan';
    }

    // Bar aksi: tampil selama mode aktif (walau belum ada yang dipilih)
    const bar = document.getElementById('bs-selection-bar');
    if (bar) bar.style.display = mode ? 'flex' : 'none';
    const countEl = document.getElementById('bs-selection-count');
    if (countEl) countEl.textContent = n === 1 ? '1 mapel dipilih' : `${n} mapel dipilih`;

    const moveBtn = document.getElementById('bs-btn-move-selected');
    if (moveBtn) {
        moveBtn.disabled = n === 0;
        moveBtn.title = n
            ? `Pindahkan ${n} mapel terpilih ke satu folder`
            : 'Pilih dulu minimal satu mapel';
    }

    const allBtn = document.getElementById('bs-btn-select-all');
    if (allBtn) {
        const total = cards.length;
        const terpilih = Array.from(cards).filter(c => bsState.selected.has(String(c.getAttribute('data-id')))).length;
        const semua = total > 0 && terpilih === total;
        allBtn.innerHTML = semua
            ? '<i class="fas fa-xmark"></i> <span>Batal pilih semua</span>'
            : '<i class="fas fa-check-double"></i> <span>Pilih semua di sini</span>';
    }
}

async function bsPindahkanTerpilih() {
    const ids = bsSelectedIds().filter(id => { const n = bsFindNode(id); return n && n.mapel; });
    if (!ids.length) return bsToast('Pilih dulu mapel yang mau dipindah', 'warning');

    const pick = await bsPickFolder({
        title: ids.length === 1 ? 'Pindahkan 1 mapel' : `Pindahkan ${ids.length} mapel`,
        hint: 'Semua mapel yang dipilih akan dipindah ke folder yang sama.',
        confirmText: 'Pindahkan ke sini',
        defaultFolderId: bsState.currentFolderId,
        allowRoot: true
    });
    if (!pick) return;

    const dest = (pick.folderId === null || pick.folderId === undefined) ? null : Number(pick.folderId);
    const tujuan = pick.folderPath || 'Bank Soal';

    bsLoading(true, 'Memindahkan mapel...');
    let pindah = 0, tetap = 0, gagal = 0;
    try {
        for (const id of ids) {
            const n = bsFindNode(id);
            if (!n) continue;
            if (bsSameParent(n.parent_id, dest)) { tetap++; continue; }
            const { error } = await adminDb.update('bank_soal_folder', Number(id), { parent_id: dest }, { silent: true });
            if (error) gagal++;
            else pindah++;
        }
    } finally {
        bsLoading(false);
    }

    if (gagal) bsToast(`${pindah} mapel dipindah, ${gagal} gagal ke "${tujuan}"`, 'error');
    else if (pindah) bsToast(`${pindah} mapel dipindahkan ke "${tujuan}"`, 'success');
    else bsToast('Mapel sudah berada di folder itu', 'info');

    // Setelah berhasil pindah, keluar dari mode pilih supaya kembali normal.
    if (pindah && !gagal) bsSetSelectMode(false);
    else bsSyncSelectionUi();
    await bsRefreshExplorer();
}

function bsNaikFolder() {
    const cur = bsFindNode(bsState.currentFolderId);
    bsBukaFolder(cur && cur.parent_id ? cur.parent_id : null);
}

function bsScrollToUpload() {
    const area = document.querySelector('#bank-soal .upload-area');
    const panel = area ? area.closest('.card-panel') : null;
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- PENCARIAN (lokal, tanpa query DB) ----------
function bsClearSearch() {
    bsState.search = '';
    bsState.searchResult = null;
    const inp = document.getElementById('bs-search');
    if (inp) inp.value = '';
    bsRender();
}

function bsOnSearch() {
    const inp = document.getElementById('bs-search');
    const q = inp ? inp.value.trim().toLowerCase() : '';
    bsState.search = q;
    if (!q) {
        bsState.searchResult = null;
        bsRender();
        return;
    }
    const folders = [];
    const mapels = [];
    bsState.nodes.forEach(n => {
        const nama = String(n.nama || '').toLowerCase();
        if (!nama.includes(q) && !bsPath(n.id).toLowerCase().includes(q)) return;
        (n.mapel ? mapels : folders).push(n);
    });
    folders.sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'));
    mapels.sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'));
    bsState.searchResult = { folders, mapels };
    bsRender();
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
    const dup = bsChildrenFolders(parent).concat(bsChildrenMapels(parent))
        .find(n => String(n.nama).toLowerCase() === nama.toLowerCase());
    if (dup) { bsToast('Sudah ada nama yang sama di lokasi ini', 'warning'); return null; }

    const { error } = await adminDb.insert('bank_soal_folder', [{ nama, parent_id: parent }]);
    if (error) { bsToast('Gagal membuat folder: ' + (error.message || error), 'error'); return null; }

    const gid = bsGuruId();
    let q = db.from('bank_soal_folder').select('*').eq('nama', nama).eq('created_by', gid);
    q = parent === null ? q.is('parent_id', null) : q.eq('parent_id', parent);
    const { data } = await q.order('id', { ascending: false }).limit(1);
    await bsLoadFolders(true);
    return (data && data[0]) ? data[0] : null;
}

async function bsCreateMapelNode(mapel, parentId) {
    const nama = String(mapel || '').trim();
    if (!nama) return null;
    const parent = (parentId === null || parentId === undefined || parentId === '') ? null : Number(parentId);

    const existing = bsMapelNodeFor(nama);
    if (existing) return existing;

    const dup = bsChildrenFolders(parent).concat(bsChildrenMapels(parent))
        .find(n => String(n.nama).toLowerCase() === nama.toLowerCase());
    if (dup) { bsToast('Sudah ada nama yang sama di lokasi itu', 'warning'); return null; }

    const { error } = await adminDb.insert('bank_soal_folder', [{ nama, mapel: nama, parent_id: parent }]);
    if (error) { bsToast('Gagal menyiapkan lokasi mapel: ' + (error.message || error), 'error'); return null; }

    const gid = bsGuruId();
    const { data } = await db.from('bank_soal_folder').select('*')
        .eq('mapel', nama).eq('created_by', gid)
        .order('id', { ascending: false }).limit(1);
    await bsLoadFolders(true);
    const node = (data && data[0]) || bsMapelNodeFor(nama);
    if (node) bsSyncJadwalDropdown();
    return node || null;
}

async function bsBuatFolder() {
    const parent = bsState.currentFolderId;
    if (parent !== null && bsFolderDepth(parent) >= BS_MAX_DEPTH) {
        return bsToast(`Maksimal ${BS_MAX_DEPTH} tingkat folder. Buat folder di lokasi yang lebih atas.`, 'error');
    }
    const lokasi = parent ? bsPath(parent) : 'Bank Soal';
    const res = await bsSwal({
        title: 'Folder Baru',
        html: `<div class="bs-swal-hint">Dibuat di: <b>${bsEsc(lokasi)}</b></div>`,
        input: 'text',
        inputPlaceholder: 'Contoh: Kelas X, Semester 1, UTS Ganjil',
        inputAttributes: { maxlength: 60 },
        showCancelButton: true,
        confirmButtonText: 'Buat Folder',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#3b82f6',
        inputValidator: (v) => {
            const t = String(v || '').trim();
            if (!t) return 'Nama folder wajib diisi';
            if (t.length > 60) return 'Maksimal 60 karakter';
            const dup = bsChildrenFolders(parent).concat(bsChildrenMapels(parent))
                .find(n => String(n.nama).toLowerCase() === t.toLowerCase());
            if (dup) return 'Sudah ada nama yang sama di sini';
        }
    });
    if (res.isDismissed || !res.value) return;
    const folder = await bsCreateFolder(res.value, parent);
    if (folder) {
        bsToast(`Folder "${folder.nama}" dibuat`, 'success');
        await bsRefreshExplorer();
    }
}

async function bsRenameFolder(id) {
    const n = bsFindNode(id);
    if (!n || n.mapel) return;
    const res = await bsSwal({
        title: 'Rename Folder',
        input: 'text',
        inputValue: n.nama,
        inputAttributes: { maxlength: 60 },
        showCancelButton: true,
        confirmButtonText: 'Simpan',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#3b82f6',
        inputValidator: (v) => {
            const t = String(v || '').trim();
            if (!t) return 'Nama folder wajib diisi';
            if (t === n.nama) return 'Nama belum berubah';
            if (t.length > 60) return 'Maksimal 60 karakter';
            const dup = bsChildrenFolders(n.parent_id).concat(bsChildrenMapels(n.parent_id))
                .find(x => String(x.id) !== String(n.id) && String(x.nama).toLowerCase() === t.toLowerCase());
            if (dup) return 'Sudah ada nama yang sama di sini';
        }
    });
    if (res.isDismissed || !res.value) return;
    const { error } = await adminDb.update('bank_soal_folder', n.id, { nama: String(res.value).trim() });
    if (error) return bsToast('Gagal rename folder: ' + (error.message || error), 'error');
    bsToast('Folder di-rename', 'success');
    await bsRefreshExplorer();
}

// ---------- RENAME / HAPUS MAPEL ----------
async function bsRenameMapel(id) {
    const n = bsFindNode(id);
    if (!n || !n.mapel) return;
    const res = await bsSwal({
        title: 'Rename Mapel',
        html: `<div class="bs-swal-hint">Nama mapel di <b>${bsMapelCount(n.mapel).total} soal</b> dan jadwal ujian ikut berubah.</div>`,
        input: 'text',
        inputValue: n.mapel,
        inputAttributes: { maxlength: 80 },
        showCancelButton: true,
        confirmButtonText: 'Simpan',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#3b82f6',
        inputValidator: (v) => {
            const t = String(v || '').trim();
            if (!t) return 'Nama mapel wajib diisi';
            if (t === n.mapel) return 'Nama belum berubah';
            if (t.length < 2) return 'Minimal 2 karakter';
            if (t.length > 80) return 'Maksimal 80 karakter';
            if (bsMapelNodeFor(t)) return 'Mapel dengan nama itu sudah ada';
            const dup = bsChildrenFolders(n.parent_id).concat(bsChildrenMapels(n.parent_id))
                .find(x => String(x.id) !== String(n.id) && String(x.nama).toLowerCase() === t.toLowerCase());
            if (dup) return 'Sudah ada nama yang sama di lokasi ini';
        }
    });
    if (res.isDismissed || !res.value) return;
    const baru = String(res.value).trim();

    bsLoading(true, 'Rename mapel...');
    try {
        // Entry mapel boleh belum punya soal — lewati rename bank_soal kalau kosong
        // (proxy menolak rename bila tidak ada soal dengan mapel itu).
        const jumlahSoal = bsMapelCount(n.mapel).total;
        if (jumlahSoal > 0) {
            const r1 = await adminDb.renameMapel(n.mapel, baru, { silent: true });
            if (r1 && r1.error) throw r1.error;
        }
        const r2 = await adminDb.update('bank_soal_folder', n.id, { nama: baru, mapel: baru }, { silent: true });
        if (r2 && r2.error) {
            // rollback supaya soal tidak kehilangan entri
            if (jumlahSoal > 0) await adminDb.renameMapel(baru, n.mapel, { silent: true });
            throw r2.error;
        }
        bsToast(`Mapel di-rename menjadi "${baru}"`, 'success');
        bsSyncJadwalDropdown();
    } catch (e) {
        bsToast('Gagal rename mapel: ' + (e && e.message ? e.message : e), 'error');
    } finally {
        bsLoading(false);
    }
    await bsRefreshExplorer();
}

async function bsHapusMapel(id) {
    const n = bsFindNode(id);
    if (!n || !n.mapel) return;
    const jumlah = bsMapelCount(n.mapel).total;

    const res = await bsSwal({
        title: 'Hapus Mapel?',
        html: `<div class="bs-del-box">
            <div class="bs-del-folder"><i class="fas fa-book-open"></i> ${bsEsc(n.mapel)}</div>
            <div class="bs-del-info">${jumlah
                ? `<b>${jumlah} soal</b> mapel ini akan dihapus permanen.`
                : 'Mapel ini belum punya soal.'}</div>
            <div class="bs-del-note">Tindakan ini tidak bisa dibatalkan.</div>
        </div>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: jumlah ? `Ya, hapus ${jumlah} soal` : 'Ya, hapus mapel',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#ef4444',
        allowOutsideClick: false
    });
    if (!res.isConfirmed) return;

    bsLoading(true, 'Menghapus mapel...');
    try {
        if (jumlah) {
            const filter = { mapel: n.mapel };
            if (n.created_by !== null && n.created_by !== undefined) filter.created_by = n.created_by;
            const d1 = await adminDb.deleteWhere('bank_soal', filter, { silent: true });
            if (d1 && d1.error) throw d1.error;
        }
        const d2 = await adminDb.delete('bank_soal_folder', n.id, { silent: true });
        if (d2 && d2.error) throw d2.error;
        if (String(bsState.currentFolderId) === String(n.id)) bsState.currentFolderId = n.parent_id || null;
        bsToast(`Mapel "${n.mapel}" dihapus`, 'success');
        bsSyncJadwalDropdown();
    } catch (e) {
        bsToast('Gagal menghapus mapel: ' + (e && e.message ? e.message : e), 'error');
    } finally {
        bsLoading(false);
    }
    await bsRefreshExplorer();
}

async function bsHapusFolder(id) {
    const n = bsFindNode(id);
    if (!n || n.mapel) return;
    const t = bsFolderTotals(n.id);

    if (!t.mapels && !t.folders) {
        const ok = await bsSwal({
            title: 'Hapus Folder?',
            html: `<div class="bs-swal-hint">Folder <b>${bsEsc(n.nama)}</b> kosong.</div>`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Hapus',
            cancelButtonText: 'Batal',
            confirmButtonColor: '#ef4444'
        });
        if (!ok.isConfirmed) return;
        const { error } = await adminDb.delete('bank_soal_folder', n.id);
        if (error) return bsToast('Gagal menghapus folder: ' + (error.message || error), 'error');
        if (String(bsState.currentFolderId) === String(n.id)) bsState.currentFolderId = n.parent_id || null;
        bsToast('Folder dihapus', 'success');
        return bsRefreshExplorer();
    }

    const res = await bsSwal({
        title: 'Hapus Folder?',
        html: `<div class="bs-del-box">
            <div class="bs-del-folder"><i class="fas fa-folder"></i> ${bsEsc(n.nama)}</div>
            <div class="bs-del-info">Folder ini berisi
                <b>${t.mapels} mapel</b>${t.folders ? ` dan <b>${t.folders} subfolder</b>` : ''},
                total <b>${t.soal} soal</b>.
                Semua akan dihapus permanen.</div>
            <div class="bs-del-note">Tindakan ini tidak bisa dibatalkan.</div>
        </div>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: `Ya, hapus semua`,
        cancelButtonText: 'Batal',
        confirmButtonColor: '#ef4444',
        allowOutsideClick: false,
        width: 560
    });
    if (!res.isConfirmed) return;

    bsLoading(true, 'Menghapus folder...');
    try {
        const ids = bsCollectSubtreeIds(n.id);
        const mapelNodes = ids.map(bsFindNode).filter(x => x && x.mapel);
        for (const m of mapelNodes) {
            if (!bsMapelCount(m.mapel).total) continue;
            const filter = { mapel: m.mapel };
            if (m.created_by !== null && m.created_by !== undefined) filter.created_by = m.created_by;
            const d = await adminDb.deleteWhere('bank_soal', filter, { silent: true });
            if (d && d.error) throw d.error;
        }
        const df = await adminDb.batchDelete('bank_soal_folder', ids, { silent: true });
        if (df && df.error) throw df.error;
        if (ids.some(x => String(x) === String(bsState.currentFolderId))) {
            bsState.currentFolderId = n.parent_id || null;
        }
        bsToast(`Folder "${n.nama}" dihapus`, 'success');
        bsSyncJadwalDropdown();
    } catch (e) {
        bsToast('Gagal menghapus folder: ' + (e && e.message ? e.message : e), 'error');
    } finally {
        bsLoading(false);
    }
    await bsRefreshExplorer();
}

// ---------- PINDAH (folder / mapel) ----------
async function bsPindahkanNode(id) {
    const n = bsFindNode(id);
    if (!n) return;
    const isFolder = !n.mapel;
    const exclude = isFolder ? bsCollectSubtreeIds(n.id).map(String) : [String(n.id)];

    const pick = await bsPickFolder({
        title: isFolder ? `Pindahkan folder "${n.nama}"` : `Pindahkan mapel "${n.nama}"`,
        confirmText: 'Pindahkan ke sini',
        defaultFolderId: n.parent_id || null,
        excludeIds: exclude,
        allowRoot: true
    });
    if (!pick) return;
    const dest = (pick.folderId === null || pick.folderId === undefined) ? null : Number(pick.folderId);

    if (isFolder) {
        if (dest !== null) {
            const destDepth = bsFolderDepth(dest);
            const need = destDepth + bsSubtreeFolderHeight(n.id);
            if (need > BS_MAX_DEPTH) {
                return bsToast(`Maksimal ${BS_MAX_DEPTH} tingkat folder (tujuan ini membuat ${need} tingkat)`, 'error');
            }
        }
    }

    const { error } = await adminDb.update('bank_soal_folder', n.id, { parent_id: dest });
    if (error) return bsToast('Gagal memindahkan: ' + (error.message || error), 'error');
    bsToast(`${isFolder ? 'Folder' : 'Mapel'} "${n.nama}" dipindahkan ke ${dest === null ? 'Bank Soal' : pick.folderPath}`, 'success');
    await bsRefreshExplorer();
}

// ---------- MENU ----------
function bsNodeMenu(id) {
    const n = bsFindNode(id);
    if (!n) return;
    const isMapel = !!n.mapel;
    bsSwal({
        title: bsEsc(n.nama),
        html: `<div class="bs-menu-list">
            <button type="button" onclick="_bsAction('open', ${Number(id)})"><i class="fas ${isMapel ? 'fa-list' : 'fa-folder-open'}"></i> ${isMapel ? 'Buka daftar soal' : 'Buka folder'}</button>
            <button type="button" onclick="_bsAction('rename', ${Number(id)})"><i class="fas fa-pen"></i> ${isMapel ? 'Rename mapel' : 'Rename folder'}</button>
            <button type="button" onclick="_bsAction('move', ${Number(id)})"><i class="fas fa-folder-tree"></i> Pindahkan</button>
            <button type="button" class="danger" onclick="_bsAction('delete', ${Number(id)})"><i class="fas fa-trash-alt"></i> ${isMapel ? 'Hapus mapel' : 'Hapus folder'}</button>
        </div>`,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText: 'Tutup',
        width: 420
    });
}

window._bsAction = function (action, id) {
    try { Swal.close(); } catch (_) { }
    setTimeout(() => {
        const n = bsFindNode(id);
        if (!n) return;
        if (action === 'open') { n.mapel ? bsBukaMapel(id) : bsBukaFolder(id); }
        else if (action === 'rename') { n.mapel ? bsRenameMapel(id) : bsRenameFolder(id); }
        else if (action === 'move') bsPindahkanNode(id);
        else if (action === 'delete') { n.mapel ? bsHapusMapel(id) : bsHapusFolder(id); }
    }, 150);
};

// ---------- PEMILIH FOLDER ----------
const bsPickState = { selectedId: null, allowRoot: true, exclude: new Set() };

function bsPickRowsHtml() {
    let html = '';
    if (bsPickState.allowRoot !== false) {
        html += `<button type="button" class="bs-pick-row ${bsPickState.selectedId === null ? 'is-selected' : ''}"
            data-id="" data-name="bank soal" onclick="bsPickSelect('')">
            <i class="fas fa-inbox"></i><span class="bs-pick-name">Bank Soal (paling atas)</span>
            <i class="fas fa-check bs-pick-check"></i>
        </button>`;
    }
    const walk = (parentId, depth) => {
        bsChildrenFolders(parentId).forEach(f => {
            if (bsPickState.exclude.has(String(f.id))) return;
            const path = bsPath(f.id);
            html += `<button type="button" class="bs-pick-row ${String(bsPickState.selectedId) === String(f.id) ? 'is-selected' : ''}"
                data-id="${Number(f.id)}" data-name="${bsEsc((f.nama + ' ' + path).toLowerCase())}"
                style="padding-left:${14 + depth * 18}px"
                onclick="bsPickSelect(${Number(f.id)})">
                <i class="fas fa-folder"></i>
                <span class="bs-pick-name" title="${bsEsc(path)}">${bsEsc(f.nama)}</span>
                <span class="bs-pick-path">${depth > 0 ? bsEsc(path) : ''}</span>
                <i class="fas fa-check bs-pick-check"></i>
            </button>`;
            walk(f.id, depth + 1);
        });
    };
    walk(null, 0);
    if (html.indexOf('bs-pick-name') === html.lastIndexOf('bs-pick-name') && bsPickState.allowRoot === false) {
        html += `<div class="bs-pick-empty">Belum ada folder. Buat folder baru di bawah.</div>`;
    }
    return html;
}

window.bsPickSelect = function (id) {
    bsPickState.selectedId = (id === '' || id === null || id === undefined) ? null : Number(id);
    const list = document.getElementById('bs-pick-list');
    if (!list) return;
    list.querySelectorAll('.bs-pick-row').forEach(row => {
        const rid = row.getAttribute('data-id');
        const match = (rid === '' && bsPickState.selectedId === null)
            || (rid !== '' && String(rid) === String(bsPickState.selectedId));
        row.classList.toggle('is-selected', match);
    });
    const hint = document.getElementById('bs-pick-target');
    if (hint) {
        const path = bsPickState.selectedId === null ? 'Bank Soal' : bsPath(bsPickState.selectedId);
        hint.innerHTML = `Lokasi terpilih: <b>${bsEsc(path)}</b>`;
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
    if (defaultId !== null && defaultId !== undefined) {
        const node = bsFindNode(defaultId);
        if (!node || node.mapel || exclude.has(String(defaultId))) defaultId = null;
    }
    bsPickState.selectedId = (defaultId === null || defaultId === undefined) ? null : Number(defaultId);

    const html = `<div class="bs-pick">
        ${opts.hint ? `<div class="bs-swal-hint" style="margin-bottom:9px;">${opts.hint}</div>` : ''}
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
                    onkeydown="if(event.key==='Enter'){event.preventDefault();Swal.clickConfirm();}">
            </div>
            <div class="bs-pick-target" id="bs-pick-target">Lokasi terpilih: <b>${bsEsc(bsPath(bsPickState.selectedId))}</b></div>
        </div>
    </div>`;

    const res = await bsSwal({
        title: opts.title || 'Pilih Folder',
        html,
        width: 560,
        showCancelButton: true,
        confirmButtonText: opts.confirmText || 'Pilih folder ini',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#3b82f6',
        focusConfirm: false,
        preConfirm: async () => {
            const nameInp = document.getElementById('bs-pick-new-name');
            const newName = nameInp ? String(nameInp.value || '').trim() : '';
            if (newName) {
                const created = await bsCreateFolder(newName, bsPickState.selectedId);
                if (!created) {
                    try { Swal.showValidationMessage('Gagal membuat folder. Coba nama lain.'); } catch (_) { }
                    return false;
                }
                return { folderId: Number(created.id), folderPath: bsPath(created.id) };
            }
            const fid = bsPickState.selectedId;
            return { folderId: fid === null ? null : Number(fid), folderPath: fid === null ? 'Bank Soal' : bsPath(fid) };
        }
    });

    if (!res.isConfirmed || !res.value) return null;
    return res.value;
}

// ---------- DIPAKAI ALUR SIMPAN SOAL ----------
// Pastikan mapel punya entri di Bank Soal. Kalau belum ada -> tanya folder
// SEKALI, lalu entri mapel dibuat di sana. Mengembalikan null bila dibatalkan.
async function bsEnsureMapelEntry(mapel, opts) {
    opts = opts || {};
    const m = String(mapel || '').trim();
    if (!m) return { folderId: null, parentId: null, created: false };

    await bsLoadFolders();
    let node = bsMapelNodeFor(m);
    if (!node) {
        await bsLoadFolders(true);
        node = bsMapelNodeFor(m);
    }
    if (node) return { folderId: node.id, parentId: node.parent_id || null, created: false };

    if (typeof opts.beforePicker === 'function') {
        try { opts.beforePicker(); } catch (_) { /* noop */ }
    }
    const pick = await bsPickFolder({
        title: 'Mapel Baru',
        hint: `Mapel <b>${bsEsc(m)}</b> belum ada di Bank Soal. Pilih folder tempat menaruhnya.`,
        confirmText: 'Tempatkan di sini',
        allowRoot: true
    });
    if (!pick) return null;

    const created = await bsCreateMapelNode(m, pick.folderId);
    if (!created) return null;
    return { folderId: created.id, parentId: created.parent_id || null, created: true };
}

async function bsRefreshAfterSoalChange() {
    bsState._loaded = false;
    await bsRefreshExplorer();
}

// ---------- SINKRON DROPDOWN JADWAL ----------
function bsSyncJadwalDropdown() {
    try {
        if (typeof populateJadwalMapelDropdown === 'function') populateJadwalMapelDropdown();
    } catch (_) { /* noop */ }
}
