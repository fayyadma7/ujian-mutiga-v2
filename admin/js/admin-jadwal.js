// @ts-nocheck
// ============================================================
// admin-jadwal.js — Jadwal Ujian Section (multi-kelas klik-toggle)
// Format kelas: "X AKL A, X AKL B" (tanpa jurusan)
// Klik per kelas, tanpa Ctrl
// ============================================================

let editingJadwalId = null;

async function populateJadwalMapelDropdown() {
    const select = document.getElementById('jadwal-mapel');
    const _jmSesi = getGuruSession();
    const _jmIsAdmin = _jmSesi && _jmSesi.isAdmin === true;
    const _jmGuruId = _jmSesi ? _jmSesi.id : null;

    let query = db.from('bank_soal').select('mapel');
    if (!_jmIsAdmin && _jmGuruId) query = query.eq('created_by', _jmGuruId);
    const { data, error } = await query;
    if (error || !data) return;
    const mapelSet = new Set();
    data.forEach(d => { if (d.mapel) mapelSet.add(d.mapel.trim()); });
    select.innerHTML = '<option value="">— Pilih Mapel dari Bank Soal —</option>';
    [...mapelSet].sort().forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        select.appendChild(opt);
    });
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
    // sync hidden select
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

async function simpanJadwal() {
    const mapel = document.getElementById('jadwal-mapel').value.trim();
    const waktuMulaiRaw = document.getElementById('jadwal-waktu').value;
    const waktuSelesaiRaw = document.getElementById('jadwal-selesai').value;
    const durasiInput = parseInt(document.getElementById('jadwal-durasi').value);
    const statusEl = document.getElementById('status-jadwal');

    if (!mapel) {
        statusEl.innerHTML = `<span style="color:red;"><i class="fas fa-exclamation-circle"></i> Nama mata pelajaran wajib diisi!</span>`;
        return;
    }
    if (!waktuMulaiRaw || !waktuSelesaiRaw) {
        statusEl.innerHTML = `<span style="color:red;"><i class="fas fa-exclamation-circle"></i> Window waktu mulai dan selesai wajib diisi!</span>`;
        return;
    }
    if (new Date(waktuSelesaiRaw) <= new Date(waktuMulaiRaw)) {
        statusEl.innerHTML = `<span style="color:red;"><i class="fas fa-exclamation-circle"></i> Batas masuk harus lebih besar dari mulai masuk!</span>`;
        return;
    }
    if (!durasiInput || durasiInput < 1) {
        statusEl.innerHTML = `<span style="color:red;"><i class="fas fa-exclamation-circle"></i> Durasi ujian wajib diisi (minimal 1 menit)!</span>`;
        return;
    }

    const waktuMulai = toLocalISOString(waktuMulaiRaw);
    const waktuSelesai = toLocalISOString(waktuSelesaiRaw);
    statusEl.innerHTML = '';

    const btnSubmit = document.getElementById('btn-submit-jadwal');
    if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...'; }

    const kelasFinal = getJadwalKelasFinal();

    const { error } = await adminDb.insert('jadwal_ujian', [{
        mapel, kelas: kelasFinal,
        waktu_mulai: waktuMulai, waktu_selesai: waktuSelesai,
        durasi_menit: durasiInput, is_aktif: true
    }]);

    if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '<i class="fas fa-plus"></i> Simpan Jadwal'; }
    if (error) { statusEl.innerHTML = `<span style="color:red;"><i class="fas fa-times-circle"></i> Gagal: ${error.message}</span>`; return; }

    statusEl.innerHTML = `<span style="color:#10b981;"><i class="fas fa-check-circle"></i> Jadwal "${mapel}" — ${durasiInput} menit/siswa berhasil disimpan!</span>`;
    document.getElementById('jadwal-mapel').value = '';
    const sel = document.getElementById('jadwal-kelas-select');
    if (sel) [...sel.options].forEach(o => o.selected = false);
    renderJadwalKelasList();
    renderJadwalKelasChips();
    document.getElementById('jadwal-waktu').value = '';
    document.getElementById('jadwal-selesai').value = '';
    document.getElementById('jadwal-durasi').value = '';
    loadJadwal();
    scheduleNextAutoDeactivate();
}

async function loadJadwal() {
    const tbody = document.getElementById('tabel-jadwal');
    const _jSesi = getGuruSession();
    const _jIsAdmin = _jSesi && _jSesi.isAdmin === true;
    const _jGuruId = _jSesi ? _jSesi.id : null;

    if (document.getElementById('jadwal-kelas-list')) populateJadwalKelasOptions();

    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:16px;"><i class="fas fa-spinner fa-spin"></i> Memuat data jadwal...</td></tr>';

    let query = db.from('jadwal_ujian').select('*, guru:created_by(id, nama)').order('id', { ascending: false });
    if (!_jIsAdmin && _jGuruId) query = query.eq('created_by', _jGuruId);
    const { data, error } = await query;
    if (error) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:16px; color:red;">Gagal memuat: ${error.message}</td></tr>`;
        return;
    }
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:16px; color:var(--text-muted);">Belum ada jadwal. Silakan buat jadwal baru di sebelah kiri.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    if (jadwalTimeout) { clearTimeout(jadwalTimeout); jadwalTimeout = null; }

    let nextRefreshTime = Infinity;

    data.forEach(j => {
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
                <td data-label="" style="text-align:center;"><input type="checkbox" class="cb-jadwal" value="${j.id}"></td>
                <td data-label="Mapel" style="font-weight:700; color:var(--text-main); text-align:left; padding:14px 38px 12px 14px; background:transparent; display:block; width:100%; border:none; border-bottom:1px solid rgba(255,255,255,.05); border-radius:0; position:static; top:auto; left:auto;">
                    <div style="display:flex; align-items:center; gap:12px; width:100%; background:transparent;">
                        <div style="width:42px; height:42px; border-radius:12px; background:rgba(59,130,246,0.15); display:flex; align-items:center; justify-content:center; flex-shrink:0;"><i class="fas fa-book-open" style="color:#60a5fa; font-size:16px;"></i></div>
                        <div style="font-weight:700; color:#f1f5f9; font-size:15px; line-height:1.1; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${j.mapel}</div>
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
                        <button class="btn btn-danger" style="padding:8px 14px; font-size:12px; background:transparent; color:#f87171; border:1px solid rgba(239,68,68,.35);" onclick="hapusJadwal(${j.id}, '${j.mapel}')"><i class="fas fa-trash"></i> <span>Hapus</span></button>
                    </div>
                </td>
            </tr>
        `;

        if (tMulai > now && tMulai.getTime() < nextRefreshTime) nextRefreshTime = tMulai.getTime();
        if (tSelesai > now && tSelesai.getTime() < nextRefreshTime) nextRefreshTime = tSelesai.getTime();
    });

    if (nextRefreshTime !== Infinity) {
        const delayMs = nextRefreshTime - new Date().getTime() + 500;
        if (delayMs < 86400000 && document.getElementById('jadwal').classList.contains('active')) {
            jadwalTimeout = setTimeout(() => { loadJadwal(); }, Math.max(1000, delayMs));
        }
    }
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
    }
}

async function mulaiEditJadwal(id) {
    const { data, error } = await db.from('jadwal_ujian').select('*').eq('id', id).single();
    if (error || !data) return;

    editingJadwalId = id;
    document.getElementById('jadwal-mapel').value = data.mapel;

    await populateJadwalKelasOptions();
    setJadwalKelasFromString(data.kelas);

    function toLocalDatetimeInput(isoStr) {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return '';
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    let selesaiVal = data.waktu_selesai;
    if (!selesaiVal && data.waktu_mulai) {
        const tMulai = new Date(data.waktu_mulai);
        if (!isNaN(tMulai.getTime())) {
            const tSelesai = new Date(tMulai.getTime() + (data.durasi_menit || 90) * 60000);
            selesaiVal = tSelesai.toISOString();
        }
    }

    document.getElementById('jadwal-waktu').value = toLocalDatetimeInput(data.waktu_mulai);
    document.getElementById('jadwal-selesai').value = toLocalDatetimeInput(selesaiVal);
    document.getElementById('jadwal-durasi').value = data.durasi_menit || '';

    const btnSubmit = document.getElementById('btn-submit-jadwal');
    if (btnSubmit) {
        btnSubmit.innerHTML = '<i class="fas fa-save"></i> Update Jadwal';
        btnSubmit.onclick = updateJadwal;
    }

    document.querySelector('#jadwal .card-panel').scrollIntoView({ behavior: 'smooth' });
}

async function updateJadwal() {
    if (!editingJadwalId) return;
    const mapel = document.getElementById('jadwal-mapel').value;
    const mulaiRaw = document.getElementById('jadwal-waktu').value;
    const selesaiRaw = document.getElementById('jadwal-selesai').value;
    const durasiInput = parseInt(document.getElementById('jadwal-durasi').value);

    if (!mulaiRaw || !selesaiRaw) return showToast('Window waktu wajib diisi!', 'error');
    if (new Date(selesaiRaw) <= new Date(mulaiRaw)) return showToast('Batas masuk harus setelah mulai masuk!', 'error');
    if (!durasiInput || durasiInput < 1) return showToast('Durasi ujian wajib diisi (min 1 menit)!', 'error');

    const mulai = toLocalISOString(mulaiRaw);
    const selesai = toLocalISOString(selesaiRaw);

    const btnSubmit = document.getElementById('btn-submit-jadwal');
    if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...'; }

    const kelasFinal = getJadwalKelasFinal();

    const { error } = await adminDb.update('jadwal_ujian', editingJadwalId, {
        mapel, kelas: kelasFinal, waktu_mulai: mulai, waktu_selesai: selesai, durasi_menit: durasiInput, is_aktif: true
    });

    if (btnSubmit) btnSubmit.innerHTML = '<i class="fas fa-plus"></i> Simpan Jadwal';

    if (error) { return showToast('Gagal update: ' + error.message, 'error'); }

    showToast(`Jadwal diperbarui! Durasi: ${durasiInput} menit / siswa`, 'success');
    editingJadwalId = null;
    if (btnSubmit) btnSubmit.onclick = simpanJadwal;

    document.getElementById('jadwal-mapel').value = '';
    const sel = document.getElementById('jadwal-kelas-select');
    if (sel) [...sel.options].forEach(o => o.selected = false);
    renderJadwalKelasList();
    renderJadwalKelasChips();
    document.getElementById('jadwal-waktu').value = '';
    document.getElementById('jadwal-selesai').value = '';
    document.getElementById('jadwal-durasi').value = '';
    document.getElementById('status-jadwal').innerHTML = '';
    loadJadwal();
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
    } else {
        const status = (action === 'active');
        for (const jid of ids) { await adminDb.update('jadwal_ujian', jid, { is_aktif: status }); }
        showToast(`${ids.length} jadwal ${status ? 'diaktifkan' : 'dinonaktifkan'}`, 'success');
    }
    loadJadwal();
}

function loadJadwalGuruOptions() {}
