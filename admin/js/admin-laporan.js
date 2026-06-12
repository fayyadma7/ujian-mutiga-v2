// @ts-nocheck
// ============================================================
// admin-laporan.js — Laporan Nilai Section
// Functions: loadNilaiSiswa, exportLaporan, exportNilaiWord,
//            clearFilterLaporan, clearSortLaporan, sortLaporanData,
//            hapusDataNilai, bulkActionNilai, toggleSortLaporan,
//            initCustomSelect, syncCustomSelect (shared from admin-core),
//            exportExcel
// ============================================================

// Custom Select (re-usable from admin-core's global scope)
function initCustomSelect(selectId) {
    const native = document.getElementById(selectId);
    if (!native || native.dataset.cslReady) return;
    native.dataset.cslReady = '1';
    const wrapper = native.parentNode;
    const container = document.createElement('div');
    container.className = 'csl-container';
    const btn = document.createElement('button');
    btn.className = 'csl-btn';
    btn.type = 'button';
    const dd = document.createElement('div');
    dd.className = 'csl-dropdown';
    dd.id = selectId + '-csldd';
    wrapper.insertBefore(container, native);
    container.appendChild(btn);
    container.appendChild(dd);
    container.appendChild(native);
    syncCustomSelect(selectId);
    btn.onclick = function(e) {
        e.stopPropagation();
        document.querySelectorAll('.csl-dropdown.show').forEach(d => { if (d.id !== dd.id) { d.classList.remove('show'); d.parentNode.querySelector('.csl-btn').classList.remove('open'); } });
        dd.classList.toggle('show');
        btn.classList.toggle('open');
    };
}

function syncCustomSelect(selectId) {
    const native = document.getElementById(selectId);
    if (!native || !native.dataset.cslReady) return;
    const container = native.closest('.csl-container');
    if (!container) return;
    const btn = container.querySelector('.csl-btn');
    const dd = document.getElementById(selectId + '-csldd');
    if (!dd) return;
    dd.innerHTML = '';
    const frag = document.createDocumentFragment();
    Array.from(native.options).forEach(opt => {
        const item = document.createElement('div');
        item.className = 'csl-option' + (opt.selected ? ' selected' : '');
        item.textContent = opt.textContent;
        item.dataset.value = opt.value;
        item.onclick = function(e) {
            e.stopPropagation();
            native.value = this.dataset.value;
            native.dispatchEvent(new Event('change', { bubbles: true }));
            dd.classList.remove('show');
            btn.classList.remove('open');
            syncCustomSelect(selectId);
        };
        frag.appendChild(item);
    });
    dd.appendChild(frag);
    btn.textContent = native.options[native.selectedIndex] ? native.options[native.selectedIndex].textContent : '';
}

// --- LAPORAN UTAMA ---
async function loadNilaiSiswa() {
    const tbody = document.getElementById('tabel-data-nilai');
    const selectMapel = document.getElementById('filter-mapel-laporan');
    const selectKelas = document.getElementById('filter-kelas-laporan');

    const filterMapel = selectMapel ? selectMapel.value : '';
    const filterKelas = selectKelas ? selectKelas.value : '';
    const searchNameLap = document.getElementById('search-nama-laporan')?.value.toLowerCase() || '';
    const filterTglAwalLap = document.getElementById('filter-tgl-awal-laporan')?.value || '';
    const filterTglAkhirLap = document.getElementById('filter-tgl-akhir-laporan')?.value || '';

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i> Sedang mengambil data...</td></tr>';

    const { data: filterData, error: filterErr } = await db.from('jawaban_ujian')
        .select('mapel, kelas')
        .order('created_at', { ascending: false });

    if (filterErr) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:red;">Gagal mengambil data database!</td></tr>';
        return;
    }

    if (selectMapel && selectKelas) {
        const mapelSet = new Set();
        const kelasSet = new Set();
        (filterData || []).forEach(d => {
            if (d.kelas) d.kelas.split(',').forEach(k => { if (k.trim()) kelasSet.add(k.trim()); });
            if (d.mapel) mapelSet.add(d.mapel.trim());
        });

        selectMapel.innerHTML = '<option value="">Semua Mapel</option>';
        [...mapelSet].sort().forEach(m => { const opt = document.createElement('option'); opt.value = m; opt.textContent = m; selectMapel.appendChild(opt); });
        selectMapel.value = filterMapel;

        selectKelas.innerHTML = '<option value="">Semua Kelas</option>';
        [...kelasSet].sort().forEach(k => { const opt = document.createElement('option'); opt.value = k; opt.textContent = k.includes('::') ? k.split('::')[1] : k; selectKelas.appendChild(opt); });
        selectKelas.value = filterKelas;

        syncCustomSelect('filter-mapel-laporan');
        syncCustomSelect('filter-kelas-laporan');
    }

    let query = db.from('jawaban_ujian').select('*', { count: 'exact' });
    if (filterMapel) query = query.eq('mapel', filterMapel);
    if (filterKelas) query = query.eq('kelas', filterKelas);
    if (searchNameLap) query = query.ilike('nama', `%${searchNameLap}%`);
    if (filterTglAwalLap) query = query.gte('created_at', filterTglAwalLap + 'T00:00:00');
    if (filterTglAkhirLap) query = query.lte('created_at', filterTglAkhirLap + 'T23:59:59');

    let currentPage = currentLapPage || 1;
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;

    const { data: allData, count: totalCount, error } = await query
        .order('created_at', { ascending: false })
        .range(startIdx, startIdx + ITEMS_PER_PAGE - 1);

    if (error) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:red;">Gagal mengambil data!</td></tr>';
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
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted);">Data tidak ditemukan.</td></tr>';
        return;
    }

    // Apply sorting
    const sortedData = typeof sortLaporanData === 'function' ? sortLaporanData(allData) : allData;

    const highlight = (text, q) => q ? text.replace(new RegExp(q, 'gi'), match => `<mark style="background-color:yellow;padding:0;">${match}</mark>`) : text;

    sortedData.forEach((siswa, index) => {
        const displayNama = highlight(siswa.nama, searchNameLap);
        tbody.innerHTML += `
            <tr>
                <td style="text-align:center;"><input type="checkbox" class="cb-laporan" value="${siswa.id}"></td>
                <td style="text-align:center;">${startIdx + index + 1}</td>
                <td style="font-weight:500;">${displayNama}</td>
                <td style="text-align:center;">
                    <span class="badge" style="display:inline-block;margin-bottom:4px;">${siswa.kelas.includes('::') ? siswa.kelas.split('::')[1] : siswa.kelas}</span><br>
                    <span style="font-size:12px;color:var(--text-muted);font-weight:600;">${siswa.mapel}</span>
                </td>
                <td style="text-align:center;font-weight:700;color:var(--primary);font-size:16px;">${siswa.skor_pg !== null ? siswa.skor_pg : '-'}</td>
                <td style="text-align:center;">
                    <span style="font-size:13px;color:var(--text-main);"><i class="fas fa-clock" style="color:var(--text-muted)"></i> ${siswa.durasi || '-'}</span><br>
                    <span style="font-size:12px;font-weight:600;color:${siswa.pelanggaran > 0 ? '#ef4444' : '#10b981'};"><i class="fas fa-exclamation-triangle"></i> ${siswa.pelanggaran || 0} Pelanggaran</span>
                </td>
                <td style="text-align:center;">
                    <span class="badge" style="background:${String(siswa.status).includes('PELANGGARAN') ? '#fee2e2' : '#d1fae5'};color:${String(siswa.status).includes('PELANGGARAN') ? '#ef4444' : '#065f46'};border:none;white-space:nowrap;display:inline-block;font-size:11px;letter-spacing:0.3px;">
                        ${siswa.status || 'SELESAI'}
                    </span>
                </td>
                <td style="text-align:center;">
                    <button class="btn btn-danger" style="padding:6px 10px;font-size:12px;" onclick="hapusDataNilai(${siswa.id}, '${siswa.nama}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
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

// --- CLEAR FILTERS ---
function clearFilterLaporan() {
    document.getElementById('search-nama-laporan').value = '';
    document.getElementById('filter-mapel-laporan').value = '';
    document.getElementById('filter-kelas-laporan').value = '';
    document.getElementById('filter-tgl-awal-laporan').value = '';
    document.getElementById('filter-tgl-akhir-laporan').value = '';
    document.getElementById('date-filter-label-laporan').textContent = 'Semua Tanggal';
    syncCustomSelect('filter-mapel-laporan');
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
async function bulkActionNilai(action) {
    const ids = Array.from(document.querySelectorAll('.cb-laporan:checked')).map(cb => cb.value);
    if (ids.length === 0) return showToast("Pilih minimal satu data!", 'info');
    const confirmed = await asyncConfirm(`Hapus <b>${ids.length} data nilai</b> terpilih?`, "Hapus Nilai Siswa?");
    if (!confirmed) { showToast("Hapus nilai siswa dibatalkan", 'info'); return; }
    const { data: backupData } = await db.from('jawaban_ujian').select('*').in('id', ids);
    const { error: lBatchErr } = await adminDb.batchDelete('jawaban_ujian', ids);
    if (lBatchErr) { showToast("Gagal menghapus: " + lBatchErr.message, 'error'); return; }
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
    const mapel = document.getElementById('filter-mapel-laporan').value;
    const kelas = document.getElementById('filter-kelas-laporan').value;
    if (!mapel || !kelas) {
        showToast("Silakan pilih 'Mapel' dan 'Kelas' terlebih dahulu di dropdown filter sebelum mengekspor data ke Excel.", 'info');
        return;
    }
    const { data, error } = await db.from('jawaban_ujian').select('*').eq('mapel', mapel).eq('kelas', kelas).order('nama', { ascending: true });
    if (error || !data || data.length === 0) { showToast("Tidak ada data nilai untuk diekspor.", 'error'); return; }

    const strukturData = [["No", "Nama Siswa", "Kelas", "Mata Pelajaran", "Skor PG", "Jawaban Essay", "Durasi Pengerjaan", "Jumlah Pelanggaran", "Detail Pelanggaran", "Status Akhir", "Waktu Selesai"]];
    data.forEach((s, index) => {
        strukturData.push([index + 1, s.nama, s.kelas, s.mapel, s.skor_pg !== null ? s.skor_pg : 0, s.jawaban_essay || '-', s.durasi || '-', s.pelanggaran || 0, s.log_pelanggaran || '-', s.status || 'SELESAI', s.created_at ? new Date(s.created_at).toLocaleString('id-ID') : '-']);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(strukturData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Laporan Nilai");
    worksheet['!cols'] = [{ wch: 5 }, { wch: 35 }, { wch: 15 }, { wch: 20 }, { wch: 10 }, { wch: 50 }, { wch: 20 }, { wch: 18 }, { wch: 60 }, { wch: 30 }, { wch: 25 }];
    XLSX.writeFile(workbook, `Nilai_${mapel}_${kelas}.xlsx`.replace(/\s+/g, '_'));
}

async function exportLaporan() { return exportExcel(); }

async function exportNilaiWord() {
    // Placeholder — Word export for laporan can be added if needed
    showToast("Fungsi export Word untuk laporan belum tersedia.", 'info');
}
