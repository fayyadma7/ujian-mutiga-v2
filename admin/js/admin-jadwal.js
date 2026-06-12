// @ts-nocheck
// ============================================================
// admin-jadwal.js — Jadwal Ujian Section
// Functions: loadJadwal, simpanJadwal, updateJadwal, 
//            mulaiEditJadwal, toggleAktifJadwal, hapusJadwal,
//            bulkActionJadwal, populateJadwalMapelDropdown,
//            loadJadwalGuruOptions, toLocalISOString
// ============================================================

let editingJadwalId = null;

async function populateJadwalMapelDropdown() {
    const select = document.getElementById('jadwal-mapel');
    const { data, error } = await db.from('bank_soal').select('mapel');
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
    const jurusan = document.getElementById('jadwal-jurusan') ? document.getElementById('jadwal-jurusan').value.trim() : '';
    const kelasInput = document.getElementById('jadwal-kelas').value.trim();
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

    let kelasFinal = kelasInput || null;
    if (jurusan && kelasInput) kelasFinal = jurusan + "::" + kelasInput;

    const { error } = await adminDb.insert('jadwal_ujian', [{
        mapel, kelas: kelasFinal,
        waktu_mulai: waktuMulai, waktu_selesai: waktuSelesai,
        durasi_menit: durasiInput, is_aktif: true
    }]);

    if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '<i class="fas fa-plus"></i> Simpan Jadwal'; }
    if (error) { statusEl.innerHTML = `<span style="color:red;"><i class="fas fa-times-circle"></i> Gagal: ${error.message}</span>`; return; }

    statusEl.innerHTML = `<span style="color:#10b981;"><i class="fas fa-check-circle"></i> Jadwal "${mapel}" — ${durasiInput} menit/siswa berhasil disimpan!</span>`;
    document.getElementById('jadwal-mapel').value = '';
    if (document.getElementById('jadwal-jurusan')) document.getElementById('jadwal-jurusan').value = '';
    document.getElementById('jadwal-kelas').value = '';
    document.getElementById('jadwal-waktu').value = '';
    document.getElementById('jadwal-selesai').value = '';
    document.getElementById('jadwal-durasi').value = '';
    loadJadwal();
    scheduleNextAutoDeactivate();
}

async function loadJadwal() {
    const tbody = document.getElementById('tabel-jadwal');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:16px;"><i class="fas fa-spinner fa-spin"></i> Memuat data jadwal...</td></tr>';

    const { data, error } = await db.from('jadwal_ujian').select('*').order('id', { ascending: false });
    if (error) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:16px; color:red;">Gagal memuat: ${error.message}</td></tr>`;
        return;
    }
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:16px; color:var(--text-muted);">Belum ada jadwal. Silakan buat jadwal baru di sebelah kiri.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    if (jadwalTimeout) { clearTimeout(jadwalTimeout); jadwalTimeout = null; }

    let nextRefreshTime = Infinity;

    data.forEach(j => {
        const isAktif = j.is_aktif === true;
        const checked = isAktif ? 'checked' : '';

        let kelasLabel = "";
        if (!j.kelas) {
            kelasLabel = `<span style="color:var(--text-muted); font-size:12px;">Semua kelas</span>`;
        } else if (typeof j.kelas === 'string' && j.kelas.includes('::')) {
            const parts = j.kelas.split('::');
            const listKelas = parts[1].split(',').map(k => k.trim()).filter(Boolean);
            kelasLabel = `<div style="line-height:1.4; display:inline-flex; flex-direction:column; gap:4px;">
                <div style="font-size:10px; color:var(--gold-light); font-weight:800; text-transform:uppercase; letter-spacing:0.5px;">${parts[0]}</div>
                <div style="display:flex; flex-wrap:wrap; gap:4px; justify-content:center;">
                    ${listKelas.map(k => `<span style="background:rgba(59,130,246,0.1); color:#93c5fd; border:1px solid rgba(59,130,246,0.2); border-radius:6px; padding:2px 8px; font-size:12px; font-weight:600; white-space:nowrap;">${k}</span>`).join('')}
                </div>
            </div>`;
        } else {
            const listKelas = j.kelas.split(',').map(k => k.trim()).filter(Boolean);
            kelasLabel = `<div style="display:flex; flex-wrap:wrap; gap:4px; justify-content:center;">
                ${listKelas.map(k => `<span style="background:rgba(59,130,246,0.1); color:#93c5fd; border:1px solid rgba(59,130,246,0.2); border-radius:6px; padding:2px 8px; font-size:12px; font-weight:600; white-space:nowrap;">${k}</span>`).join('')}
            </div>`;
        }

        const now = new Date();
        const tMulai = j.waktu_mulai ? new Date(j.waktu_mulai) : null;
        let tSelesai = j.waktu_selesai ? new Date(j.waktu_selesai) : null;

        if (!tMulai || isNaN(tMulai.getTime())) {
            tbody.innerHTML += `<tr><td colspan="8" style="color:red; text-align:center;">Data jadwal ID ${j.id} tidak valid (Waktu Mulai kosong)</td></tr>`;
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
            ? `<div style="text-align:center; line-height:1.4;"><strong style="font-size:18px; color:#10b981;">${durasiPerSiswa}</strong><div style="font-size:10px; color:var(--text-muted); font-weight:600;">menit</div></div>`
            : `<span style="color:#94a3b8; font-size:11px;">—</span>`;

        const displayWaktu = `
            <div style="line-height:1.6; font-size:12px; white-space:nowrap;">
                <div style="font-size:10px; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:0.3px; margin-bottom:2px;">📅 Siswa Boleh Masuk:</div>
                <div style="font-weight:700; color:var(--text-main); font-size:11px;">${tMulai.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                <div>
                    <span style="color:#10b981; font-weight:700; font-size:13px;">${tMulai.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span style="color:var(--text-muted); margin:0 2px;">s/d</span>
                    <span style="color:#ef4444; font-weight:700; font-size:13px;">${tSelesai.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
            </div>
        `;

        tbody.innerHTML += `
            <tr>
                <td style="text-align:center;"><input type="checkbox" class="cb-jadwal" value="${j.id}"></td>
                <td style="font-weight:700; color:var(--text-main); text-align:left; padding:14px 10px 14px 18px;">${j.mapel}</td>
                <td style="text-align:center; padding:14px 12px;">${kelasLabel}</td>
                <td style="text-align:center; white-space:nowrap;">${displayWaktu}</td>
                <td style="text-align:center;">${durasiLabel}</td>
                <td style="text-align:center;">${statusAuto}</td>
                <td style="text-align:center;">
                    <label class="toggle">
                        <input type="checkbox" ${checked} onchange="toggleAktifJadwal(${j.id}, this.checked)">
                        <span class="toggle-slider"></span>
                    </label>
                </td>
                <td style="text-align:center;">
                    <div style="display:flex; gap:5px; justify-content:center;">
                        <button class="btn btn-primary" style="padding:6px 8px; font-size:11px; background:var(--primary);" onclick="mulaiEditJadwal(${j.id})" title="Edit Jadwal"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-danger" style="padding:6px 8px; font-size:11px;" onclick="hapusJadwal(${j.id}, '${j.mapel}')"><i class="fas fa-trash"></i></button>
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

    const inputJurusan = document.getElementById('jadwal-jurusan');
    const inputKelas = document.getElementById('jadwal-kelas');
    if (data.kelas && data.kelas.includes('::')) {
        const parts = data.kelas.split('::');
        if (inputJurusan) inputJurusan.value = parts[0];
        inputKelas.value = parts[1];
    } else {
        if (inputJurusan) inputJurusan.value = '';
        inputKelas.value = data.kelas || '';
    }

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

    document.querySelector('.card-panel').scrollIntoView({ behavior: 'smooth' });
}

async function updateJadwal() {
    if (!editingJadwalId) return;
    const mapel = document.getElementById('jadwal-mapel').value;
    const jurusan = document.getElementById('jadwal-jurusan') ? document.getElementById('jadwal-jurusan').value.trim() : '';
    const kelasInput = document.getElementById('jadwal-kelas').value.trim();
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

    let kelasFinal = kelasInput || null;
    if (jurusan && kelasInput) kelasFinal = jurusan + "::" + kelasInput;

    const { error } = await adminDb.update('jadwal_ujian', editingJadwalId, {
        mapel, kelas: kelasFinal, waktu_mulai: mulai, waktu_selesai: selesai, durasi_menit: durasiInput, is_aktif: true
    });

    if (btnSubmit) btnSubmit.innerHTML = '<i class="fas fa-plus"></i> Simpan Jadwal';

    if (error) { return showToast('Gagal update: ' + error.message, 'error'); }

    showToast(`Jadwal diperbarui! Durasi: ${durasiInput} menit / siswa`, 'success');
    editingJadwalId = null;
    if (btnSubmit) btnSubmit.onclick = simpanJadwal;

    document.getElementById('jadwal-mapel').value = '';
    if (document.getElementById('jadwal-jurusan')) document.getElementById('jadwal-jurusan').value = '';
    document.getElementById('jadwal-kelas').value = '';
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

function loadJadwalGuruOptions() {
    // This is a placeholder; guru options can be loaded from /guru table if needed
    // Currently jadwal doesn't assign guru, so this is a no-op.
}
