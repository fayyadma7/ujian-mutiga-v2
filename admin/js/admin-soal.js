// @ts-nocheck
// ============================================================
// admin-soal.js — Bank Soal Section
// Functions: loadPreviewSoal, bukaDetailSoal, simpanSoalManual,
//            resetFormManual, populatePreviewMapel, populateManualMapel,
//            editSatuSoal, simpanEditSoal, hapusSatuSoal, hapusSatuMapel,
//            bulkActionSoal, bulkActionMapel, filterMapel, filterPreviewSoal,
//            exportSoalWord, downloadTemplate,
//            downloadTemplateWord, tambahOpsiManual, kurangOpsiManual,
//            toggleManualOpsi, insertImageToEditor, formatManualText,
//            formatEditText, openVisualMathEditor, insertMathFormulaToFocused,
//            insertMathFormulaToEditFocused, loadMathJax, openManualInputPanel,
//            togglePanelManual, analisisSoal
//            (Word import, Excel import event listeners)
// ============================================================

// MathJax lazy loader
let mathJaxLoaded = false;

function loadMathJax() {
    if (mathJaxLoaded) return;
    mathJaxLoaded = true;
    window.MathJax = {
        tex: { inlineMath: [['$', '$'], ['\\(', '\\)']], displayMath: [['$$', '$$']] },
        svg: { fontCache: 'global' },
        startup: { pageReady: () => {} }
    };
    const script = document.createElement('script');
    script.id = 'MathJax-script-dynamic';
    script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';
    script.async = true;
    document.head.appendChild(script);
}

// --- PREVIEW SOAL ---
async function populatePreviewMapel() {
    const tbody = document.getElementById('tabel-daftar-mapel');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Memuat data...</td></tr>';

    const { data, error } = await db.from('bank_soal').select('mapel');
    if (error || !data) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:red;">Gagal memuat data: ${error?.message}</td></tr>`;
        return;
    }

    const mapelCounts = {};
    data.forEach(row => {
        if (row.mapel) mapelCounts[row.mapel] = (mapelCounts[row.mapel] || 0) + 1;
    });

    const uniqueMapels = Object.keys(mapelCounts).sort();

    if (uniqueMapels.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#94a3b8;">Belum ada bank soal. Silakan upload soal via Excel atau Word.</td></tr>';
        const optMapel = document.getElementById('jadwal-mapel');
        if (optMapel) optMapel.innerHTML = '<option value="">— Belum ada Mapel di Bank Soal —</option>';
        return;
    }

    let html = '';
    let optHtml = '<option value="">— Pilih Mapel dari Bank Soal —</option>';
    uniqueMapels.forEach(mapel => {
        const count = mapelCounts[mapel];
        html += `
            <tr>
                <td style="text-align:center;"><input type="checkbox" class="cb-mapel" value="${mapel}"></td>
                <td style="font-weight:600; color:var(--text-main); text-align:left; padding-left:15px;">${mapel}</td>
                <td style="text-align:center;"><span class="badge" style="background:rgba(99, 102, 241, 0.1); color:var(--primary); border:1px solid rgba(99, 102, 241, 0.2);">${count} Soal</span></td>
                <td style="text-align:center;">
                    <div class="action-buttons" style="display:flex; justify-content:center; gap:8px;">
                        <button class="btn btn-outline" style="padding: 4px 8px; font-size: 11px;" onclick="bukaDetailSoal('${mapel}')">
                            <i class="fas fa-eye"></i> Lihat Soal
                        </button>
                        <button class="btn btn-outline" style="padding: 4px 8px; font-size: 11px; color: #ef4444; border-color: #fecaca;" onclick="hapusSatuMapel('${mapel}')">
                            <i class="fas fa-trash-alt"></i> Hapus
                        </button>
                    </div>
                </td>
            </tr>
        `;
        optHtml += `<option value="${mapel}">${mapel}</option>`;
    });
    tbody.innerHTML = html;

    const optMapel = document.getElementById('jadwal-mapel');
    if (optMapel) {
        const currentVal = optMapel.value;
        optMapel.innerHTML = optHtml;
        if (uniqueMapels.includes(currentVal)) optMapel.value = currentVal;
    }
}

function bukaDetailSoal(mapel) {
    document.getElementById('panel-daftar-mapel').style.display = 'none';
    document.getElementById('panel-detail-soal').style.display = 'block';
    document.getElementById('detail-mapel-title').innerText = "Mata Pelajaran: " + mapel;
    document.getElementById('preview-mapel').value = mapel;
    loadPreviewSoal();
}

function tutupDetailSoal() {
    document.getElementById('panel-detail-soal').style.display = 'none';
    document.getElementById('panel-daftar-mapel').style.display = 'block';
    document.getElementById('preview-mapel').value = "";
    document.getElementById('preview-container').innerHTML = "";
    document.getElementById('detail-mapel-title').innerText = "";
    populatePreviewMapel();
}

async function loadPreviewSoal() {
    const mapel = document.getElementById('preview-mapel').value;
    const container = document.getElementById('preview-container');
    if (!mapel) {
        container.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-muted);">Pilih Mata Pelajaran di atas untuk melihat preview soal.</div>';
        return;
    }

    const currentScrollTop = container ? container.scrollTop : 0;
    const hasQuestions = container.querySelector('.soal-item') !== null;
    if (!hasQuestions) {
        container.innerHTML = '<div style="text-align:center; padding:30px; color:var(--primary);"><i class="fas fa-spinner fa-spin"></i> Memuat soal...</div>';
    }

    const { data, error } = await db.from('bank_soal').select('*').eq('mapel', mapel).order('id', { ascending: true });

    if (error || !data || data.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:30px; color:var(--danger);"><i class="fas fa-exclamation-circle"></i> Tidak ada soal ditemukan untuk mapel ini.</div>';
        return;
    }

    let html = '';
    data.forEach((s, idx) => {
        html += `
            <div class="soal-item" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 8px; padding: 15px; margin-bottom: 15px; backdrop-filter: blur(5px); transition: border-color 0.2s;">
                <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <input type="checkbox" class="cb-soal" value="${s.id}">
                        <strong style="color:var(--text-main);">Soal No. ${idx + 1}</strong>
                    </div>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <span class="badge" style="background:${s.tipe_soal === 'ESSAY' ? 'rgba(99,102,241,0.1)' : 'rgba(16,185,129,0.1)'}; color:${s.tipe_soal === 'ESSAY' ? '#a5b4fc' : '#34d399'}; border:1px solid ${s.tipe_soal === 'ESSAY' ? 'rgba(99,102,241,0.2)' : 'rgba(16,185,129,0.2)'}; margin-right:10px;">${s.tipe_soal || 'PG'}</span>
                        <button onclick="editSatuSoal(${s.id})" style="background:none; border:none; color:var(--primary); cursor:pointer; margin-right:10px;" title="Edit Soal ini">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="hapusSatuSoal(${s.id})" style="background:none; border:none; color:var(--danger); cursor:pointer;" title="Hapus Soal ini">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </div>
                <div class="teks-pertanyaan" style="margin-bottom: 12px; line-height:1.5; font-size:15px;">${s.pertanyaan}</div>
        `;

        if (s.tipe_soal !== 'ESSAY') {
            html += `<ul style="list-style-type: none; padding-left: 0; margin-bottom: 15px; font-size:14px;">`;
            const opsi = ['a', 'b', 'c', 'd', 'e'];
            opsi.forEach(o => {
                const val = s[`opsi_${o}`];
                if (val) {
                    html += `
                        <li style="display:flex; align-items:flex-start; padding:6px 0; ${s.kunci_jawaban === o.toUpperCase() ? 'font-weight:bold; color:var(--success);' : ''}">
                            <strong style="margin-right:8px; flex-shrink:0;">${o.toUpperCase()}.</strong> 
                            <div style="flex-grow:1; overflow-x:auto; overflow-y:hidden; line-height:1.5; margin-top:-2px;">${val}</div>
                        </li>`;
                }
            });
            html += `</ul>`;
        }

        html += `
                <div style="background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:4px; font-size:13px; color:var(--text-muted); border:1px solid var(--border);">
                    <strong style="color:var(--text-main);">Kunci Jawaban:</strong> <span style="${s.tipe_soal !== 'ESSAY' ? 'font-weight:bold; color:var(--success);' : ''}">${s.kunci_jawaban || '-'}</span>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
    if (container) container.scrollTop = currentScrollTop;
    // KaTeX render untuk $$...$$ (prioritas) lalu MathJax fallback
    if (typeof AIGenerator !== 'undefined' && AIGenerator._renderMathInContainer) {
        AIGenerator._renderMathInContainer(container);
    }
    if (window.MathJax) {
        MathJax.typesetClear([container]);
        MathJax.typesetPromise([container]).catch(err => console.error(err));
    }
}

function filterMapel() {
    const query = document.getElementById('search-mapel').value.trim().toLowerCase();
    const rows = document.querySelectorAll('#tabel-daftar-mapel tr');
    rows.forEach(row => {
        if (row.cells.length < 4) return;
        const mapelName = row.cells[1] ? row.cells[1].innerText.toLowerCase() : "";
        row.style.display = mapelName.includes(query) ? '' : 'none';
    });
}

function filterPreviewSoal() {
    const query = document.getElementById('search-soal').value.trim().toLowerCase();
    const items = document.querySelectorAll('.soal-item');
    items.forEach(item => {
        const teksDiv = item.querySelector('.teks-pertanyaan');
        if (!item.dataset.original) item.dataset.original = teksDiv.innerHTML;
        const originalHtml = item.dataset.original;
        const textOnly = item.innerText.toLowerCase();
        if (query === "") {
            teksDiv.innerHTML = originalHtml;
            item.style.display = 'block';
        } else if (textOnly.includes(query)) {
            item.style.display = 'block';
            const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const safeQuery = escapeRegExp(query);
            const regex = new RegExp(`(${safeQuery})(?![^<]*>)`, 'gi');
            teksDiv.innerHTML = originalHtml.replace(regex, '<mark style="background:#fef08a; color:#854d0e; padding:0 2px; border-radius:2px;">$1</mark>');
        } else {
            item.style.display = 'none';
        }
    });
}

// --- HAPUS SOAL ---
async function hapusSatuSoal(id) {
    if (!await asyncConfirm("Yakin ingin menghapus satu soal ini secara permanen?", "Hapus Soal?")) return;
    const { data: savedSoal, error: fetchError } = await db.from('bank_soal').select('*').eq('id', id).single();
    const { error } = await adminDb.delete('bank_soal', id);
    if (error) showToast("Gagal menghapus: " + error.message, 'error');
    else {
        const undoDelete = async () => {
            if (savedSoal) {
                const { error: insertError } = await adminDb.insert('bank_soal', [savedSoal]);
                if (insertError) showToast("Gagal membatalkan penghapusan: " + insertError.message, 'error');
                else { showToast("Soal berhasil dipulihkan", 'success'); loadPreviewSoal(); }
            }
        };
        showToast("Soal berhasil dihapus", 'success', undoDelete, 'Batalkan');
        loadPreviewSoal();
    }
}

async function hapusSatuMapel(mapel) {
    const { data: jadwalAktif } = await db.from('jadwal_ujian').select('id').eq('mapel', mapel);
    if (jadwalAktif && jadwalAktif.length > 0) {
        Swal.fire({
            title: 'Akses Ditolak!',
            html: `Mata pelajaran <b style="color:var(--primary);">${mapel}</b> sedang digunakan di <b>Jadwal Ujian</b>.<br><br>Sistem memblokir tindakan ini agar ujian siswa tidak error/blank. Hapus jadwalnya terlebih dahulu di tab Jadwal.`,
            icon: 'error', confirmButtonColor: '#ef4444', confirmButtonText: 'Mengerti'
        });
        return;
    }
    if (!await asyncConfirm(`Hapus <b>SEMUA SOAL</b> untuk mata pelajaran <b>"${mapel}"</b>?<br>Tindakan ini menghapus seluruh data bank soal untuk mapel ini.`, "Hapus Seluruh Mapel?")) return;

    const { data: backupSoal } = await db.from('bank_soal').select('*').eq('mapel', mapel);
    const { data: idsSoal } = await db.from('bank_soal').select('id').eq('mapel', mapel);
    if (!idsSoal || idsSoal.length === 0) { showToast("Tidak ada soal untuk mapel ini", 'info'); return; }

    const { error } = await adminDb.batchDelete('bank_soal', idsSoal.map(i => i.id));
    if (error) showToast("Gagal menghapus mapel: " + error.message, 'error');
    else {
        const undoFunc = async () => {
            if (backupSoal && backupSoal.length > 0) {
                await chunkedInsert('bank_soal', backupSoal);
                populatePreviewMapel();
                showToast(`Soal mapel "${mapel}" berhasil di-restore`, 'success');
            }
        };
        showToast(`Seluruh soal untuk mapel "${mapel}" berhasil dihapus`, 'success', undoFunc, 'Undo');
        populatePreviewMapel();
    }
}

async function bulkActionMapel(action) {
    const mapels = Array.from(document.querySelectorAll('.cb-mapel:checked')).map(cb => cb.value);
    if (mapels.length === 0) return showToast("Pilih minimal satu mata pelajaran!", 'info');
    if (action === 'delete') {
        const { data: jadwalAktif } = await db.from('jadwal_ujian').select('mapel').in('mapel', mapels);
        if (jadwalAktif && jadwalAktif.length > 0) {
            const usedMapels = [...new Set(jadwalAktif.map(j => j.mapel))].join(', ');
            Swal.fire({
                title: 'Tindakan Diblokir!',
                html: `Mata pelajaran berikut sedang digunakan di <b>Jadwal Ujian</b>:<br><br><b style="color:var(--primary);">${usedMapels}</b><br><br>Sistem memblokir tindakan ini untuk mencegah kerusakan ujian. Hapus jadwal terkait terlebih dahulu.`,
                icon: 'error', confirmButtonColor: '#ef4444', confirmButtonText: 'Mengerti'
            });
            return;
        }
        const confirmed = await asyncConfirm(`Hapus <b>${mapels.length} mata pelajaran</b> terpilih beserta seluruh soalnya?<br>Tindakan ini tidak bisa dibatalkan.`, "Hapus Bank Soal?");
        if (!confirmed) { showToast("Hapus mata pelajaran dibatalkan", 'info'); return; }
        const { data: backupData } = await db.from('bank_soal').select('*').in('mapel', mapels);
        const { data: idsData } = await db.from('bank_soal').select('id').in('mapel', mapels);
        if (!idsData || idsData.length === 0) { showToast("Tidak ada soal untuk mapel dipilih", 'info'); return; }
        const { error } = await adminDb.batchDelete('bank_soal', idsData.map(i => i.id));
        if (error) showToast("Gagal menghapus: " + error.message, 'error');
        else {
            const undoFunc = async () => {
                if (backupData && backupData.length > 0) {
                    await chunkedInsert('bank_soal', backupData);
                    populatePreviewMapel();
                    showToast(`${mapels.length} mata pelajaran berhasil di-restore`, 'success');
                }
            };
            showToast(`${mapels.length} mata pelajaran berhasil dihapus`, 'success', undoFunc, 'Undo');
            populatePreviewMapel();
        }
    }
}

async function bulkActionSoal(action) {
    const ids = Array.from(document.querySelectorAll('.cb-soal:checked')).map(cb => cb.value);
    if (ids.length === 0) return showToast("Pilih minimal satu soal!", 'info');

    if (action === 'delete') {
        const confirmed = await asyncConfirm(`Hapus <b>${ids.length} soal</b> terpilih secara permanen?`, "Hapus Bank Soal?");
        if (!confirmed) { showToast("Hapus soal dibatalkan", 'info'); return; }
        const { data: backupData } = await db.from('bank_soal').select('*').in('id', ids);
        const { error: sBatchErr } = await adminDb.batchDelete('bank_soal', ids);
        if (sBatchErr) { showToast("Gagal menghapus: " + sBatchErr.message, 'error'); return; }
        const undoFunc = async () => {
            if (backupData && backupData.length > 0) {
                await chunkedInsert('bank_soal', backupData);
                loadPreviewSoal();
                showToast(`${ids.length} soal berhasil di-restore`, 'success');
            }
        };
        showToast(`${ids.length} soal berhasil dihapus`, 'success', undoFunc, 'Undo');
        loadPreviewSoal();
    } else if (action === 'move') {
        const actionType = await Swal.fire({
            title: 'Pindah atau Salin?',
            text: 'Apakah Anda ingin Memindahkan soal ini (Cut) atau Menyalinnya (Copy)?',
            icon: 'question', showCancelButton: true, showDenyButton: true,
            confirmButtonText: 'Pindahkan (Cut)', denyButtonText: 'Salin (Copy)', cancelButtonText: 'Batal',
            confirmButtonColor: '#10b981', denyButtonColor: '#3b82f6'
        });
        if (actionType.isDismissed) return;
        const isCopy = actionType.isDenied;
        const { value: newMapel } = await Swal.fire({
            title: isCopy ? 'Salin ke Mapel' : 'Pindah ke Mapel',
            input: 'text', inputLabel: 'Masukkan nama Mata Pelajaran tujuan',
            inputPlaceholder: 'Contoh: Matematika Kelas X',
            showCancelButton: true, confirmButtonText: isCopy ? 'Salin' : 'Pindahkan',
            cancelButtonText: 'Batal', confirmButtonColor: '#10b981',
            inputValidator: (value) => { if (!value) return 'Nama mapel tidak boleh kosong!'; }
        });
        if (newMapel) {
            Swal.fire({ title: 'Memproses...', allowOutsideClick: false });
            Swal.showLoading();
            if (isCopy) {
                const { data: soalToCopy, error: fetchErr } = await db.from('bank_soal').select('*').in('id', ids);
                if (fetchErr || !soalToCopy) return Swal.fire('Gagal!', fetchErr ? fetchErr.message : 'Gagal mengambil data soal', 'error');
                const newSoalArray = soalToCopy.map(s => { const { id, created_at, ...rest } = s; rest.mapel = newMapel; return rest; });
                const { error: insertErr } = await chunkedInsert('bank_soal', newSoalArray);
                if (insertErr) Swal.fire('Gagal!', insertErr.message, 'error');
                else Swal.fire('Berhasil!', `${ids.length} soal berhasil disalin ke mapel ${newMapel}`, 'success').then(() => populatePreviewMapel());
            } else {
                let moveErr = null;
                for (const sid of ids) {
                    const { error: e } = await adminDb.update('bank_soal', sid, { mapel: newMapel });
                    if (e) moveErr = e;
                }
                if (moveErr) Swal.fire('Gagal!', moveErr.message, 'error');
                else Swal.fire('Berhasil!', `${ids.length} soal berhasil dipindahkan ke mapel ${newMapel}`, 'success').then(() => { loadPreviewSoal(); populatePreviewMapel(); });
            }
        }
    }
}

// --- MANUAL SOAL INPUT ---
let lastManualFocusedId = 'manual-pertanyaan';
let manualOpsiCount = 5;
let lastEditFocusedId = 'edit-soal-pertanyaan';
let editOpsiCount = 5;

function setLastManualFocus(id, label) {
    lastManualFocusedId = id;
    const lbl = document.getElementById('manual-toolbar-target-label');
    if (lbl) lbl.textContent = 'Target: ' + label;
}

function setLastEditFocus(id, label) {
    lastEditFocusedId = id;
    const lbl = document.getElementById('edit-toolbar-target-label');
    if (lbl) lbl.textContent = 'Target: ' + label;
}

function insertImageToFocused(input) { insertImageToEditor(lastManualFocusedId, input); }
function insertImageToEditFocused(input) { insertImageToEditor(lastEditFocusedId, input); }

function insertImageToEditor(targetId, input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = `<img src="${e.target.result}" style="max-width:100%; max-height:250px; display:block; margin:6px 0; border-radius:6px;">`;
        const el = document.getElementById(targetId);
        el.focus();
        document.execCommand('insertHTML', false, img);
        if (window.MathJax) MathJax.typesetPromise([el]);
    };
    reader.readAsDataURL(file);
    input.value = '';
}

function formatManualText(command) {
    const el = document.getElementById(lastManualFocusedId || 'manual-pertanyaan');
    if (!el) return;
    el.focus();
    document.execCommand(command, false, null);
}

function formatEditText(command) {
    const el = document.getElementById(lastEditFocusedId || 'edit-soal-pertanyaan');
    if (!el) return;
    el.focus();
    document.execCommand(command, false, null);
}

function toggleManualOpsi() {
    const tipe = document.getElementById('manual-tipe').value;
    const container = document.getElementById('manual-opsi-container');
    const kunci = document.getElementById('manual-kunci-wrapper');
    if (tipe === 'ESSAY') {
        container.style.display = 'none';
        kunci.style.display = 'none';
    } else {
        container.style.display = 'block';
        kunci.style.display = 'block';
    }
}

function updateManualOpsiVisibility() {
    const items = document.querySelectorAll('.manual-opsi-item');
    items.forEach((item, index) => item.style.display = (index < manualOpsiCount) ? 'block' : 'none');
    document.getElementById('manual-opsi-count-label').textContent = manualOpsiCount + ' opsi';
    const grid = document.getElementById('manual-opsi-grid');
    const lastItem = items[manualOpsiCount - 1];
    items.forEach(i => i.style.gridColumn = 'auto');
    if (manualOpsiCount % 2 !== 0 && manualOpsiCount > 0 && lastItem) lastItem.style.gridColumn = 'span 2';
}

function addManualOpsi() { if (manualOpsiCount < 5) { manualOpsiCount++; updateManualOpsiVisibility(); } }
function removeManualOpsi() { if (manualOpsiCount > 2) { manualOpsiCount--; updateManualOpsiVisibility(); } }

async function populateManualMapel() {
    const dl = document.getElementById('manual-mapel-list');
    if (!dl) return;
    const { data } = await db.from('bank_soal').select('mapel').order('mapel', { ascending: true });
    if (!data) return;
    const mapels = [...new Set(data.map(r => r.mapel))];
    dl.innerHTML = '';
    mapels.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        dl.appendChild(opt);
    });
}

async function simpanSoalManual() {
    const btn = document.getElementById('btn-simpan-manual');
    const status = document.getElementById('status-manual');

    let mapel = document.getElementById('manual-mapel').value.trim();
    if (!mapel) return showToast('Pilih atau isi Mata Pelajaran terlebih dahulu!', 'error');

    const tipe = document.getElementById('manual-tipe').value;
    const pertanyaan = document.getElementById('manual-pertanyaan').innerHTML.trim();
    const kunci = document.getElementById('manual-kunci').value.trim().toUpperCase();

    if (!pertanyaan || pertanyaan === '' || pertanyaan === '<br>') return showToast('Pertanyaan tidak boleh kosong!', 'error');
    if (tipe !== 'ESSAY' && !kunci) return showToast('Kunci jawaban wajib diisi untuk soal Pilihan Ganda!', 'error');

    const origHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
    status.innerHTML = '';

    const payload = {
        mapel, tipe_soal: tipe,
        pertanyaan, kunci_jawaban: tipe === 'ESSAY' ? '-' : kunci,
        opsi_a: '', opsi_b: '', opsi_c: '', opsi_d: '', opsi_e: ''
    };

    if (tipe !== 'ESSAY') {
        if (manualOpsiCount >= 1) payload.opsi_a = document.getElementById('manual-opsi-a').innerHTML.trim();
        if (manualOpsiCount >= 2) payload.opsi_b = document.getElementById('manual-opsi-b').innerHTML.trim();
        if (manualOpsiCount >= 3) payload.opsi_c = document.getElementById('manual-opsi-c').innerHTML.trim();
        if (manualOpsiCount >= 4) payload.opsi_d = document.getElementById('manual-opsi-d').innerHTML.trim();
        if (manualOpsiCount >= 5) payload.opsi_e = document.getElementById('manual-opsi-e').innerHTML.trim();
    }

    const { error } = await adminDb.insert('bank_soal', [payload]);
    if (error) {
        status.innerHTML = `<span style="color:red;"><i class="fas fa-times-circle"></i> Gagal: ${error.message}</span>`;
    } else {
        status.innerHTML = `<span style="color:#10b981;"><i class="fas fa-check-circle"></i> Soal berhasil disimpan ke Mapel "<b>${mapel}</b>"!</span>`;
        resetFormManual();
        populatePreviewMapel().then(() => bukaDetailSoal(mapel));
        populateManualMapel();
    }
    btn.disabled = false;
    btn.innerHTML = origHTML;
}

function resetFormManual() {
    document.getElementById('manual-pertanyaan').innerHTML = '';
    ['a','b','c','d','e'].forEach(o => document.getElementById(`manual-opsi-${o}`).innerHTML = '');
    document.getElementById('manual-kunci').value = '';
    document.getElementById('status-manual').innerHTML = '';
}

function openManualInputPanel() {
    const form = document.getElementById('form-input-manual');
    const btn = document.getElementById('btn-toggle-manual');
    form.style.display = 'block';
    btn.innerHTML = '<i class="fas fa-chevron-up" id="icon-toggle-manual"></i> Sembunyikan Form';
    populateManualMapel();
    document.getElementById('panel-input-manual').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => document.getElementById('manual-mapel').focus(), 500);
}

function togglePanelManual() {
    const form = document.getElementById('form-input-manual');
    const icon = document.getElementById('icon-toggle-manual');
    const btn = document.getElementById('btn-toggle-manual');
    if (form.style.display === 'none') {
        form.style.display = 'block';
        icon.className = 'fas fa-chevron-up';
        btn.innerHTML = '<i class="fas fa-chevron-up" id="icon-toggle-manual"></i> Sembunyikan Form';
        populateManualMapel();
    } else {
        form.style.display = 'none';
        btn.innerHTML = '<i class="fas fa-chevron-down" id="icon-toggle-manual"></i> Tampilkan Form';
    }
}

// --- MATH VISUAL EDITOR ---
window.switchSwalMathTab = function(tabName) {
    document.querySelectorAll('.swal-math-panel').forEach(p => p.style.display = 'none');
    const panel = document.getElementById('swal-math-panel-' + tabName);
    if (panel) panel.style.display = 'grid';
    document.querySelectorAll('.swal-math-tab').forEach(b => {
        b.style.background = 'rgba(255, 255, 255, 0.05)';
        b.style.color = 'var(--text-muted)';
    });
    if (event && event.currentTarget) {
        event.currentTarget.style.background = 'rgba(124, 58, 237, 0.2)';
        event.currentTarget.style.color = '#a78bfa';
    }
};

window.insertSwalMathSnippet = function(snippet, offset) {
    const input = document.getElementById('swal-math-text-input');
    if (!input) return;
    const startPos = input.selectionStart;
    const endPos = input.selectionEnd;
    input.value = input.value.substring(0, startPos) + snippet + input.value.substring(endPos);
    input.focus();
    const newPos = startPos + (offset || snippet.length);
    input.setSelectionRange(newPos, newPos);
    window.updateSwalMathPreview(input.value);
};

let previewTimeout = null;

window.updateSwalMathPreview = function(latex) {
    const previewEl = document.getElementById('swal-math-live-preview');
    if (!previewEl) return;
    if (!latex.trim()) {
        previewEl.innerHTML = '<span style="color:#a78bfa; font-size:13px; font-style:italic;">Ketik rumus atau klik tombol pembantu di atas...</span>';
        return;
    }
    previewEl.textContent = '\\(' + latex + '\\)';
    if (previewTimeout) clearTimeout(previewTimeout);
    previewTimeout = setTimeout(() => {
        if (window.MathJax) MathJax.typesetPromise([previewEl]).catch(err => console.log(err));
    }, 200);
};

async function openVisualMathEditor(targetElementId, targetName) {
    const cleanTargetName = targetName.replace(/Target:\s*/i, '').trim();
    const { value: formula } = await Swal.fire({
        title: '∑ Pembantu Rumus Matematika',
        width: '600px',
        customClass: { popup: 'swal-dark-popup' },
        html: `
            <div style="font-family: 'Plus Jakarta Sans', sans-serif; text-align: left; margin-top: 10px;">
                <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px; margin-top: 0;">
                    Target Sisipkan: <b style="color: var(--primary);">${cleanTargetName}</b>
                </p>
                <div style="display: flex; gap: 4px; margin-bottom: 12px; border-bottom: 1px solid var(--border); padding-bottom: 6px; overflow-x: auto; white-space: nowrap;">
                    <button type="button" class="swal-math-tab" onclick="switchSwalMathTab('dasar')" style="background: rgba(124, 58, 237, 0.2); border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight: 600; color: #a78bfa; transition: 0.2s;">Dasar</button>
                    <button type="button" class="swal-math-tab" onclick="switchSwalMathTab('lanjut')" style="background: rgba(255, 255, 255, 0.05); border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight: 600; color: var(--text-muted); transition: 0.2s;">Lanjut</button>
                    <button type="button" class="swal-math-tab" onclick="switchSwalMathTab('matriks')" style="background: rgba(255, 255, 255, 0.05); border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight: 600; color: var(--text-muted); transition: 0.2s;">Matriks</button>
                    <button type="button" class="swal-math-tab" onclick="switchSwalMathTab('simbol')" style="background: rgba(255, 255, 255, 0.05); border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight: 600; color: var(--text-muted); transition: 0.2s;">Simbol</button>
                </div>
                <div id="swal-math-panel-dasar" class="swal-math-panel" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 15px;">
                    <button type="button" onclick="insertSwalMathSnippet('\\\\frac{}{}', 6)" title="Pecahan" style="padding:10px 4px;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.02);color:var(--text-main);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:0.2s;" onmouseover="this.style.borderColor='var(--primary)';this.style.background='rgba(124,58,237,0.1)'" onmouseout="this.style.borderColor='var(--border)';this.style.background='rgba(255,255,255,0.02)'"><span style="font-size:15px;font-weight:500;">\\(\\frac{a}{b}\\)</span><span style="font-size:10px;color:var(--text-muted);">Pecahan</span></button>
                    <button type="button" onclick="insertSwalMathSnippet('\\\\sqrt{}', 6)" title="Akar" style="padding:10px 4px;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.02);color:var(--text-main);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:0.2s;" onmouseover="this.style.borderColor='var(--primary)';this.style.background='rgba(124,58,237,0.1)'" onmouseout="this.style.borderColor='var(--border)';this.style.background='rgba(255,255,255,0.02)'"><span style="font-size:15px;font-weight:500;">\\(\\sqrt{x}\\)</span><span style="font-size:10px;color:var(--text-muted);">Akar</span></button>
                    <button type="button" onclick="insertSwalMathSnippet('^{}', 2)" title="Pangkat" style="padding:10px 4px;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.02);color:var(--text-main);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:0.2s;" onmouseover="this.style.borderColor='var(--primary)';this.style.background='rgba(124,58,237,0.1)'" onmouseout="this.style.borderColor='var(--border)';this.style.background='rgba(255,255,255,0.02)'"><span style="font-size:15px;font-weight:500;">\\(x^y\\)</span><span style="font-size:10px;color:var(--text-muted);">Pangkat</span></button>
                    <button type="button" onclick="insertSwalMathSnippet('_{}', 2)" title="Subscript" style="padding:10px 4px;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.02);color:var(--text-main);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:0.2s;" onmouseover="this.style.borderColor='var(--primary)';this.style.background='rgba(124,58,237,0.1)'" onmouseout="this.style.borderColor='var(--border)';this.style.background='rgba(255,255,255,0.02)'"><span style="font-size:15px;font-weight:500;">\\(x_y\\)</span><span style="font-size:10px;color:var(--text-muted);">Subscript</span></button>
                </div>
                <div id="swal-math-panel-lanjut" class="swal-math-panel" style="display:none;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:15px;">
                    <button type="button" onclick="insertSwalMathSnippet('\\\\int_{}^{} dx', 6)" title="Integral Tentu" style="padding:10px 4px;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.02);color:var(--text-main);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:0.2s;" onmouseover="this.style.borderColor='var(--primary)';this.style.background='rgba(124,58,237,0.1)'" onmouseout="this.style.borderColor='var(--border)';this.style.background='rgba(255,255,255,0.02)'"><span style="font-size:15px;font-weight:500;">\\(\\int_{a}^{b}\\)</span><span style="font-size:10px;color:var(--text-muted);">Integral</span></button>
                    <button type="button" onclick="insertSwalMathSnippet('\\\\lim_{x \\\\to }', 12)" title="Limit" style="padding:10px 4px;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.02);color:var(--text-main);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:0.2s;" onmouseover="this.style.borderColor='var(--primary)';this.style.background='rgba(124,58,237,0.1)'" onmouseout="this.style.borderColor='var(--border)';this.style.background='rgba(255,255,255,0.02)'"><span style="font-size:15px;font-weight:500;">\\(\\lim_{x\\to0}\\)</span><span style="font-size:10px;color:var(--text-muted);">Limit</span></button>
                    <button type="button" onclick="insertSwalMathSnippet('\\\\sum_{i=1}^{}', 12)" title="Sigma Penjumlahan" style="padding:10px 4px;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.02);color:var(--text-main);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:0.2s;" onmouseover="this.style.borderColor='var(--primary)';this.style.background='rgba(124,58,237,0.1)'" onmouseout="this.style.borderColor='var(--border)';this.style.background='rgba(255,255,255,0.02)'"><span style="font-size:15px;font-weight:500;">\\(\\sum\\)</span><span style="font-size:10px;color:var(--text-muted);">Sigma</span></button>
                </div>
                <div id="swal-math-panel-matriks" class="swal-math-panel" style="display:none;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:15px;">
                    <button type="button" onclick="insertSwalMathSnippet('\\\\begin{pmatrix} & \\\\\\\\ & \\\\end{pmatrix}', 17)" title="Matriks 2x2" style="padding:10px 4px;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.02);color:var(--text-main);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:0.2s;" onmouseover="this.style.borderColor='var(--primary)';this.style.background='rgba(124,58,237,0.1)'" onmouseout="this.style.borderColor='var(--border)';this.style.background='rgba(255,255,255,0.02)'"><span style="font-size:14px;font-weight:500;">\\(\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\\)</span><span style="font-size:10px;color:var(--text-muted);">Matriks 2x2</span></button>
                    <button type="button" onclick="insertSwalMathSnippet('\\\\begin{pmatrix} & & \\\\\\\\ & & \\\\\\\\ & & \\\\end{pmatrix}', 17)" title="Matriks 3x3" style="padding:10px 4px;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.02);color:var(--text-main);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:0.2s;" onmouseover="this.style.borderColor='var(--primary)';this.style.background='rgba(124,58,237,0.1)'" onmouseout="this.style.borderColor='var(--border)';this.style.background='rgba(255,255,255,0.02)'"><span style="font-size:12px;font-weight:500;">\\(\\begin{pmatrix}3x3\\end{pmatrix}\\)</span><span style="font-size:10px;color:var(--text-muted);">Matriks 3x3</span></button>
                </div>
                <div id="swal-math-panel-simbol" class="swal-math-panel" style="display:none;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:15px;"></div>
                <div style="margin-bottom:12px;">
                    <label for="swal-math-text-input" style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Kode Rumus LaTeX:</label>
                    <textarea id="swal-math-text-input" class="swal2-textarea" style="margin:0;width:100%;height:65px;font-family:monospace;font-size:14px;box-sizing:border-box;padding:8px;border:1px solid var(--border);border-radius:6px;outline:none;resize:none;background:rgba(0,0,0,0.2);color:var(--text-main);" placeholder="Tulis rumus Anda atau klik tombol pembantu di atas..."></textarea>
                </div>
                <div>
                    <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">Hasil Tampilan Rumus (Live Preview):</label>
                    <div id="swal-math-live-preview" style="min-height:55px;padding:12px;border:1px dashed var(--primary);border-radius:8px;background:rgba(124,58,237,0.05);display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--text-main);overflow-x:auto;box-sizing:border-box;"><span style="color:#a78bfa;font-size:13px;font-style:italic;">Ketik rumus atau klik tombol pembantu di atas...</span></div>
                </div>
            </div>
        `,
        confirmButtonText: 'Sisipkan Rumus', confirmButtonColor: '#7c3aed',
        showCancelButton: true, cancelButtonText: 'Batal',
        didOpen: () => {
            const input = document.getElementById('swal-math-text-input');
            input.focus();
            if (window.MathJax) MathJax.typesetPromise([document.getElementById('swal2-html-container')]).catch(e => console.log(e));
            const simbolPanel = document.getElementById('swal-math-panel-simbol');
            const symbols = [
                { latex: '\\\\pm', char: '±' }, { latex: '\\\\times', char: '×' }, { latex: '\\\\div', char: '÷' },
                { latex: '\\\\neq', char: '≠' }, { latex: '\\\\leq', char: '≤' }, { latex: '\\\\geq', char: '≥' },
                { latex: '\\\\infty', char: '∞' }, { latex: '\\\\pi', char: 'π' }, { latex: '\\\\alpha', char: 'α' },
                { latex: '\\\\beta', char: 'β' }, { latex: '\\\\theta', char: 'θ' }, { latex: '\\\\Delta', char: 'Δ' },
                { latex: '\\\\approx', char: '≈' }, { latex: '\\\\equiv', char: '≡' }, { latex: '\\\\to', char: '→' },
                { latex: '\\\\sin', char: 'sin' }, { latex: '\\\\cos', char: 'cos' }, { latex: '\\\\tan', char: 'tan' }
            ];
            simbolPanel.innerHTML = '';
            symbols.forEach(s => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.title = s.char;
                btn.style.cssText = 'padding:8px 4px;border:1px solid var(--border);border-radius:6px;cursor:pointer;background:rgba(255,255,255,0.02);font-size:14px;text-align:center;color:var(--text-main);transition:0.2s;';
                btn.onmouseover = () => { btn.style.borderColor = 'var(--primary)'; btn.style.background = 'rgba(124,58,237,0.1)'; };
                btn.onmouseout = () => { btn.style.borderColor = 'var(--border)'; btn.style.background = 'rgba(255,255,255,0.02)'; };
                const cleanSnippet = s.latex.replace(/\\\\/g, '\\');
                btn.onclick = () => window.insertSwalMathSnippet(cleanSnippet, cleanSnippet.length);
                btn.textContent = s.char;
                simbolPanel.appendChild(btn);
            });
            input.addEventListener('input', (e) => window.updateSwalMathPreview(e.target.value));
        },
        preConfirm: () => document.getElementById('swal-math-text-input').value.trim()
    });

    if (!formula) return;
    const el = document.getElementById(targetElementId);
    if (!el) return;
    el.focus();
    const htmlToInsert = ` \\(${formula}\\) `;
    document.execCommand('insertHTML', false, htmlToInsert);
    if (window.MathJax) MathJax.typesetPromise([el]);
}

async function insertMathFormulaToFocused() {
    const targetLabel = document.getElementById('manual-toolbar-target-label')?.textContent || 'Pertanyaan';
    await openVisualMathEditor(lastManualFocusedId || 'manual-pertanyaan', targetLabel);
}

async function insertMathFormulaToEditFocused() {
    const { value: formula } = await Swal.fire({
        title: '∑ Sisipkan Rumus Matematika',
        customClass: { popup: 'swal-dark-popup' },
        html: `
            <p style="font-size:13px;color:var(--text-muted);margin-bottom:8px;">Target: <b style="color:var(--primary);">${document.getElementById('edit-toolbar-target-label')?.textContent || 'Pertanyaan'}</b></p>
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Tulis rumus dalam format LaTeX</p>
            <input id="swal-math-input-edit" class="swal2-input" placeholder="Contoh: \\\\frac{a}{b} = c" style="font-family:monospace;background:rgba(0,0,0,0.2);color:var(--text-main);border:1px solid var(--border);">
        `,
        confirmButtonText: 'Sisipkan', confirmButtonColor: '#7c3aed',
        showCancelButton: true, cancelButtonText: 'Batal',
        didOpen: () => document.getElementById('swal-math-input-edit').focus(),
        preConfirm: () => document.getElementById('swal-math-input-edit').value.trim()
    });
    if (!formula) return;
    const el = document.getElementById(lastEditFocusedId);
    if (!el) return;
    el.focus();
    document.execCommand('insertHTML', false, ` \\(${formula}\\) `);
    if (window.MathJax) MathJax.typesetPromise([el]);
}

// --- EDIT SOAL ---
function updateEditOpsiVisibility() {
    const items = document.querySelectorAll('.edit-opsi-item');
    items.forEach((item, index) => item.style.display = (index < editOpsiCount) ? 'block' : 'none');
    const lbl = document.getElementById('edit-opsi-count-label');
    if (lbl) lbl.textContent = editOpsiCount + ' opsi';
    const lastItem = items[editOpsiCount - 1];
    items.forEach(i => i.style.gridColumn = 'auto');
    if (editOpsiCount % 2 !== 0 && editOpsiCount > 0 && lastItem) lastItem.style.gridColumn = 'span 2';
}

function addEditOpsi() { if (editOpsiCount < 5) { editOpsiCount++; updateEditOpsiVisibility(); } }
function removeEditOpsi() { if (editOpsiCount > 2) { editOpsiCount--; updateEditOpsiVisibility(); } }

async function editSatuSoal(id) {
    loadMathJax();
    const { data, error } = await db.from('bank_soal').select('*').eq('id', id).single();
    if (error || !data) return showToast('Gagal mengambil data soal', 'error');

    document.getElementById('edit-soal-id').value = data.id;
    document.getElementById('edit-soal-tipe').value = data.tipe_soal;
    document.getElementById('edit-soal-pertanyaan').innerHTML = data.pertanyaan || '';
    document.getElementById('edit-soal-kunci').value = data.kunci_jawaban || '';

    const opsiContainer = document.getElementById('edit-opsi-container');
    const kunciWrapper = document.getElementById('edit-kunci-wrapper');
    if (data.tipe_soal === 'ESSAY') {
        opsiContainer.style.display = 'none';
        if (kunciWrapper) kunciWrapper.style.display = 'none';
    } else {
        opsiContainer.style.display = 'block';
        if (kunciWrapper) kunciWrapper.style.display = 'block';
        let count = 0;
        if (data.opsi_a) count = 1;
        if (data.opsi_b) count = 2;
        if (data.opsi_c) count = 3;
        if (data.opsi_d) count = 4;
        if (data.opsi_e) count = 5;
        if (count < 2) count = 5;
        editOpsiCount = count;
        updateEditOpsiVisibility();
        document.getElementById('edit-soal-a').innerHTML = data.opsi_a || '';
        document.getElementById('edit-soal-b').innerHTML = data.opsi_b || '';
        document.getElementById('edit-soal-c').innerHTML = data.opsi_c || '';
        document.getElementById('edit-soal-d').innerHTML = data.opsi_d || '';
        document.getElementById('edit-soal-e').innerHTML = data.opsi_e || '';
    }

    document.getElementById('modalEditSoal').style.display = 'flex';
}

async function simpanEditSoal() {
    const id = document.getElementById('edit-soal-id').value;
    const tipe = document.getElementById('edit-soal-tipe').value;
    const btn = document.getElementById('btn-simpan-edit-soal');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
    btn.disabled = true;

    const payload = {
        pertanyaan: document.getElementById('edit-soal-pertanyaan').innerHTML,
        kunci_jawaban: tipe === 'ESSAY' ? '-' : document.getElementById('edit-soal-kunci').value
    };

    if (tipe !== 'ESSAY') {
        payload.opsi_a = editOpsiCount >= 1 ? document.getElementById('edit-soal-a').innerHTML : '';
        payload.opsi_b = editOpsiCount >= 2 ? document.getElementById('edit-soal-b').innerHTML : '';
        payload.opsi_c = editOpsiCount >= 3 ? document.getElementById('edit-soal-c').innerHTML : '';
        payload.opsi_d = editOpsiCount >= 4 ? document.getElementById('edit-soal-d').innerHTML : '';
        payload.opsi_e = editOpsiCount >= 5 ? document.getElementById('edit-soal-e').innerHTML : '';
    }

    const { error } = await adminDb.update('bank_soal', id, payload);
    btn.innerHTML = '<i class="fas fa-save"></i> Simpan';
    btn.disabled = false;

    if (error) showToast('Gagal menyimpan soal: ' + error.message, 'error');
    else {
        showToast('Soal berhasil diupdate!', 'success');
        document.getElementById('modalEditSoal').style.display = 'none';
        loadPreviewSoal();
    }
}

async function editSoal(id) { return editSatuSoal(id); }
async function simpanEditSoal(id) { return simpanEditSoal(); }

// --- EXPORT WORD ---
async function exportSoalWord(btn) {
    const mapel = document.getElementById('preview-mapel').value;
    if (!mapel) return showToast("Mata pelajaran belum dipilih", "error");

    const result = await Swal.fire({
        title: 'Unduh Soal Ujian',
        text: "Apakah Anda ingin menyertakan Kunci Jawaban di dalam file Word?",
        icon: 'question', showCancelButton: true, showDenyButton: true,
        confirmButtonColor: '#10b981', denyButtonColor: '#3b82f6', cancelButtonColor: '#64748b',
        confirmButtonText: '<i class="fas fa-check"></i> Beserta Kunci',
        denyButtonText: '<i class="fas fa-times"></i> Tanpa Kunci',
        cancelButtonText: 'Batal'
    });

    if (result.isDismissed) return;
    const withKey = result.isConfirmed;

    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mengekspor...';
    btn.disabled = true;

    const { data, error } = await db.from('bank_soal').select('*').eq('mapel', mapel).order('id', { ascending: true });
    if (error || !data || data.length === 0) {
        btn.innerHTML = originalHTML; btn.disabled = false;
        return showToast("Tidak ada soal untuk diekspor", "error");
    }

    if (!window.docx) {
        try { await loadScript('https://unpkg.com/docx@7.8.2/build/index.js'); } catch (e) {
            btn.innerHTML = originalHTML; btn.disabled = false;
            return Swal.fire('Error', 'Gagal memuat library Word. Periksa koneksi internet.', 'error');
        }
    }

    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell } = window.docx;

    const children = [
        new Paragraph({ text: `SOAL UJIAN - ${mapel.toUpperCase()}`, heading: HeadingLevel.HEADING_1, alignment: "center", spacing: { after: 400 } })
    ];

    const parseHtmlToDocx = (html, prefix = "") => {
        const elements = [];
        if (!html) return elements;
        const tmp = document.createElement("div");
        tmp.innerHTML = html;
        let prefixApplied = false;
        const processNode = (node) => {
            const nodeName = node.nodeName.toLowerCase();
            if (nodeName === "table") {
                const rows = [];
                const trs = node.querySelectorAll("tr");
                trs.forEach(tr => {
                    const cells = [];
                    const tds = tr.querySelectorAll("th, td");
                    tds.forEach(td => {
                        const cellParagraphs = parseHtmlToDocx(td.innerHTML);
                        if (cellParagraphs.length === 0) cellParagraphs.push(new Paragraph({ text: "" }));
                        cells.push(new TableCell({ children: cellParagraphs, width: { size: 100 / tds.length, type: "pct" } }));
                    });
                    if (cells.length > 0) rows.push(new TableRow({ children: cells }));
                });
                if (rows.length > 0) {
                    elements.push(new Table({ rows, width: { size: 100, type: "pct" }, borders: { top: { style: "single", size: 4, color: "CCCCCC" }, bottom: { style: "single", size: 4, color: "CCCCCC" }, left: { style: "single", size: 4, color: "CCCCCC" }, right: { style: "single", size: 4, color: "CCCCCC" }, insideHorizontal: { style: "single", size: 4, color: "EAEAEA" }, insideVertical: { style: "single", size: 4, color: "EAEAEA" } } }));
                }
            } else if (nodeName === "p" || nodeName === "div") {
                const runs = [];
                if (!prefixApplied && prefix) { runs.push(new TextRun({ text: prefix, bold: true })); prefixApplied = true; }
                const extractRuns = (child) => {
                    if (child.nodeType === 3) { const text = child.textContent; if (text) runs.push(new TextRun({ text })); }
                    else if (child.nodeType === 1) {
                        const childName = child.nodeName.toLowerCase();
                        const bold = childName === "strong" || childName === "b";
                        const italic = childName === "em" || childName === "i";
                        const underline = childName === "u";
                        child.childNodes.forEach(grandchild => {
                            if (grandchild.nodeType === 3) runs.push(new TextRun({ text: grandchild.textContent, bold, italic, underline: underline ? {} : undefined }));
                            else extractRuns(grandchild);
                        });
                    }
                };
                node.childNodes.forEach(extractRuns);
                elements.push(new Paragraph({ children: runs }));
            } else if (node.nodeType === 3) {
                const txt = node.textContent.trim();
                if (txt) {
                    const runs = [];
                    if (!prefixApplied && prefix) { runs.push(new TextRun({ text: prefix, bold: true })); prefixApplied = true; }
                    runs.push(new TextRun({ text: txt }));
                    elements.push(new Paragraph({ children: runs }));
                }
            } else {
                const text = (node.textContent || "").trim();
                if (text) {
                    const runs = [];
                    if (!prefixApplied && prefix) { runs.push(new TextRun({ text: prefix, bold: true })); prefixApplied = true; }
                    runs.push(new TextRun({ text }));
                    elements.push(new Paragraph({ children: runs }));
                }
            }
        };
        Array.from(tmp.childNodes).forEach(processNode);
        return elements;
    };

    data.forEach((s, idx) => {
        const qElements = parseHtmlToDocx(s.pertanyaan, `${idx + 1}. `);
        children.push(...(qElements.length === 0 ? [new Paragraph({ text: `${idx + 1}. ` })] : qElements));
        if (s.tipe_soal !== 'ESSAY') {
            ['a','b','c','d','e'].forEach(o => {
                const val = s[`opsi_${o}`];
                const optElements = parseHtmlToDocx(val, `${o.toUpperCase()}. `);
                children.push(...(optElements.length === 0 ? [new Paragraph({ text: `${o.toUpperCase()}. ` })] : optElements));
            });
            if (withKey && s.kunci_jawaban) children.push(new Paragraph({ text: `Kunci: ${s.kunci_jawaban.toUpperCase().charAt(0)}` }));
        } else {
            children.push(new Paragraph({ text: `Tipe: ESSAY` }));
            if (withKey && s.kunci_jawaban) {
                const keyElements = parseHtmlToDocx(s.kunci_jawaban, "Kunci: ");
                children.push(...(keyElements.length === 0 ? [new Paragraph({ text: "Kunci: " })] : keyElements));
            }
        }
    });

    const doc = new Document({ sections: [{ properties: {}, children }] });
    Packer.toBlob(doc).then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `SOAL_UJIAN_${mapel.replace(/\s+/g, '_').toUpperCase()}.docx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        Swal.fire({ icon: 'success', title: 'Berhasil Diekspor!', text: 'Dokumen Word (.docx) berhasil diunduh.', confirmButtonColor: '#10b981' });
    }).catch(err => { console.error(err); showToast("Gagal mengunduh dokumen .docx", "error"); })
    .finally(() => { btn.innerHTML = originalHTML; btn.disabled = false; });
}

// --- DOWNLOAD TEMPLATE ---
async function downloadTemplate() {
    if (typeof XLSX === 'undefined') {
        try { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'); }
        catch (e) { return showToast('Gagal memuat library Excel. Periksa koneksi.', 'error'); }
    }
    const strukturData = [
        ["No", "Pertanyaan", "Opsi A", "Opsi B", "Opsi C", "Opsi D", "Opsi E", "Kunci Jawaban", "Tipe Soal (PG/ESSAY)"],
        [1, "Tulis soal pilihan ganda di sini...", "Pilihan A", "Pilihan B", "Pilihan C", "Pilihan D", "Pilihan E", "A", "PG"],
        [2, "Tulis soal essay di sini...", "", "", "", "", "", "", "ESSAY"]
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(strukturData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Soal Ujian");
    worksheet['!cols'] = [
        { wch: 5 }, { wch: 60 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 22 }
    ];
    XLSX.writeFile(workbook, "Template_Soal_Mutiga.xlsx");
}

async function downloadTemplateWord() {
    if (!window.docx) {
        try { await loadScript('https://unpkg.com/docx@7.8.2/build/index.js'); } catch (e) {
            Swal.fire('Error', 'Gagal memuat library Word. Periksa koneksi internet.', 'error');
            return;
        }
    }
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = window.docx;
    const doc = new Document({
        sections: [{
            properties: {},
            children: [
                new Paragraph({ text: "TEMPLATE DAN PANDUAN FORMAT SOAL WORD", heading: HeadingLevel.HEADING_1, alignment: "center" }),
                new Paragraph({ children: [new TextRun({ text: "Aturan Penting:", bold: true })], spacing: { before: 200 } }),
                new Paragraph({ text: "1. Nomor soal harus diawali angka dan titik (Contoh: 1. )" }),
                new Paragraph({ text: "2. Opsi jawaban (Pilihan Ganda) harus diawali huruf kapital dan titik (Contoh: A. )" }),
                new Paragraph({ text: "3. Kunci Jawaban ditaruh di paling bawah setiap soal (Contoh: Kunci: A)" }),
                new Paragraph({ text: "4. Untuk soal Essay, gunakan kode Tipe: ESSAY tepat di bawah pertanyaan." }),
                new Paragraph({ text: "5. Gambar/Rumus silakan di-paste bebas di posisi pertanyaan atau opsi." }),
                new Paragraph({ children: [new TextRun({ text: "CONTOH 1 (Pilihan Ganda Biasa):", bold: true })], spacing: { before: 400 } }),
                new Paragraph({ text: "1. Siapakah penemu bola lampu pijar?" }),
                new Paragraph({ text: "A. Thomas Alva Edison" }), new Paragraph({ text: "B. Albert Einstein" }),
                new Paragraph({ text: "C. Isaac Newton" }), new Paragraph({ text: "D. Nikola Tesla" }),
                new Paragraph({ text: "E. Alexander Graham Bell" }), new Paragraph({ text: "Kunci: A" }),
                new Paragraph({ children: [new TextRun({ text: "--- Silakan hapus panduan di atas dan mulai ketik soal Anda di bawah garis ini ---", italics: true })], spacing: { before: 600, after: 200 } }),
                new Paragraph({ text: "1. Pertanyaan pertama Anda..." }),
                new Paragraph({ text: "A. " }), new Paragraph({ text: "B. " }),
                new Paragraph({ text: "C. " }), new Paragraph({ text: "D. " }),
                new Paragraph({ text: "E. " }), new Paragraph({ text: "Kunci: A" }),
            ]
        }]
    });
    Packer.toBlob(doc).then(blob => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "Template_Soal_Mutiga.docx";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    }).catch(err => { console.error(err); Swal.fire("Error", "Gagal membuat file Word.", "error"); });
}

// --- EXCEL IMPORT ---
document.getElementById('inputExcel')?.addEventListener('change', async function(e) {
    // Lazy load XLSX jika belum ada
    if (typeof XLSX === 'undefined') {
        try { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'); }
        catch (err) { return showToast('Gagal memuat library Excel', 'error'); }
    }
    const file = e.target.files[0];
    const mapel = document.getElementById('mapel-upload').value.trim();
    const status = document.getElementById('status-upload');
    if (!file) return;
    if (!mapel) {
        status.innerHTML = `<span style="color:red;"><i class="fas fa-exclamation-circle"></i> Isi dulu Nama Mata Pelajaran di atas sebelum upload file!</span>`;
        e.target.value = '';
        return;
    }
    status.innerHTML = `<span style="color:var(--primary);"><i class="fas fa-spinner fa-spin"></i> Mengecek status Mapel...</span>`;
    const action = await handleMapelConflict(mapel, status);
    if (action === 'cancel' || action === 'error') { e.target.value = ''; if (action === 'cancel') status.innerHTML = ''; return; }
    status.innerHTML = `<span style="color:var(--primary);"><i class="fas fa-spinner fa-spin"></i> Membaca file Excel...</span>`;
    const reader = new FileReader();
    reader.onload = async function(evt) {
        try {
            const dataArray = new Uint8Array(evt.target.result);
            const workbook = XLSX.read(dataArray, { type: 'array' });
            const namaSheetPertama = workbook.SheetNames[0];
            const isiExcel = XLSX.utils.sheet_to_json(workbook.Sheets[namaSheetPertama]);
            status.innerHTML = `<span style="color:var(--primary);"><i class="fas fa-spinner fa-spin"></i> Menyimpan ${isiExcel.length} soal ke database...</span>`;
            const dataSoalSupabase = isiExcel.map(row => ({
                mapel, pertanyaan: row["Pertanyaan"] || "",
                opsi_a: row["Opsi A"] || "", opsi_b: row["Opsi B"] || "",
                opsi_c: row["Opsi C"] || "", opsi_d: row["Opsi D"] || "", opsi_e: row["Opsi E"] || "",
                kunci_jawaban: row["Kunci Jawaban"] || "", tipe_soal: row["Tipe Soal (PG/ESSAY)"] || "PG"
            }));
            const { error } = await chunkedInsert('bank_soal', dataSoalSupabase);
            if (error) throw error;
            status.innerHTML = `<span style="color:#10b981;"><i class="fas fa-check-circle"></i> Sukses! ${isiExcel.length} baris soal untuk "${mapel}" tersimpan di database.</span>`;
            document.getElementById('inputExcel').value = '';
            await populatePreviewMapel();
            bukaDetailSoal(mapel);
        } catch (err) { status.innerHTML = `<span style="color:red;"><i class="fas fa-exclamation-triangle"></i> Gagal menyimpan soal: ${err.message}</span>`; }
    };
    reader.readAsArrayBuffer(file);
});

// --- WORD IMPORT ---
document.getElementById('inputWord')?.addEventListener('change', async function(e) {
    // Lazy load mammoth jika belum ada
    if (typeof mammoth === 'undefined') {
        try { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.4.21/mammoth.browser.min.js'); }
        catch (err) { return showToast('Gagal memuat library Word', 'error'); }
    }
    const file = e.target.files[0];
    const mapel = document.getElementById('mapel-upload').value.trim();
    const status = document.getElementById('status-upload');
    if (!file) return;
    if (!mapel) {
        status.innerHTML = `<span style="color:red;"><i class="fas fa-exclamation-circle"></i> Isi dulu Nama Mata Pelajaran sebelum upload file Word!</span>`;
        e.target.value = ''; return;
    }
    status.innerHTML = `<span style="color:var(--primary);"><i class="fas fa-spinner fa-spin"></i> Mengecek status Mapel...</span>`;
    const action = await handleMapelConflict(mapel, status);
    if (action === 'cancel' || action === 'error') { e.target.value = ''; if (action === 'cancel') status.innerHTML = ''; return; }
    status.innerHTML = `<span style="color:var(--primary);"><i class="fas fa-spinner fa-spin"></i> Membaca dokumen Word...</span>`;
    const reader = new FileReader();
    reader.onload = function(event) {
        const arrayBuffer = event.target.result;
        mammoth.convertToHtml({ arrayBuffer }).then(async function(result) {
            const htmlContent = result.value;
            const div = document.createElement('div');
            div.innerHTML = htmlContent;
            let blocks = [];
            Array.from(div.childNodes).forEach(node => {
                if (node.nodeName.toLowerCase() === 'p' || node.nodeName.toLowerCase() === 'div') {
                    let currentBlock = document.createElement(node.nodeName);
                    Array.from(node.childNodes).forEach(child => {
                        if (child.nodeName.toLowerCase() === 'br') {
                            if (currentBlock.textContent.trim() !== '' || currentBlock.querySelector('img')) blocks.push(currentBlock);
                            currentBlock = document.createElement(node.nodeName);
                        } else currentBlock.appendChild(child.cloneNode(true));
                    });
                    if (currentBlock.textContent.trim() !== '' || currentBlock.querySelector('img')) blocks.push(currentBlock);
                } else if (node.nodeName.toLowerCase() === 'ol' || node.nodeName.toLowerCase() === 'ul') {
                    Array.from(node.children).forEach(li => { let p = document.createElement('p'); p.innerHTML = li.innerHTML; blocks.push(p); });
                } else if (node.nodeType === 1 || (node.nodeType === 3 && node.textContent.trim() !== '')) blocks.push(node);
            });

            const stripPrefixFromDom = (node, regex) => {
                const traverse = (current) => {
                    for (let child of current.childNodes) {
                        if (child.nodeType === 3) { const oldText = child.textContent; const newText = oldText.replace(regex, ''); if (newText !== oldText) { child.textContent = newText; return true; } }
                        else if (child.nodeType === 1) { if (traverse(child)) return true; }
                    } return false;
                }; traverse(node);
            };
            const cleanEmptyTags = (node) => {
                const traverse = (current) => {
                    for (let i = current.childNodes.length - 1; i >= 0; i--) {
                        const child = current.childNodes[i];
                        if (child.nodeType === 1) { traverse(child); if (child.innerHTML.trim() === '') current.removeChild(child); }
                    }
                }; traverse(node);
            };

            let soalArray = [], currentSoal = null, currentMode = null, currentQuestionNumber = null;
            blocks.forEach(node => {
                let textMatch = node.textContent.trim();
                let num = null;
                const dotMatch = textMatch.match(/^(\d+)[\.\)]\s/);
                if (dotMatch) num = parseInt(dotMatch[1]);
                else { const soalMatch = textMatch.match(/^Soal\s+(\d+)/i); if (soalMatch) num = parseInt(soalMatch[1]); }

                let isNewSoal = false;
                if (num !== null && currentMode !== 'Q') {
                    if (currentQuestionNumber === null) isNewSoal = true;
                    else { if (currentMode === null) isNewSoal = true; else isNewSoal = (num === currentQuestionNumber + 1); }
                }

                let isOpsiA = /^A[\.\)]\s/i.test(textMatch), isOpsiB = /^B[\.\)]\s/i.test(textMatch),
                    isOpsiC = /^C[\.\)]\s/i.test(textMatch), isOpsiD = /^D[\.\)]\s/i.test(textMatch),
                    isOpsiE = /^E[\.\)]\s/i.test(textMatch), isKunci = /^Kunci\s*:\s*/i.test(textMatch),
                    isTipe = /^Tipe\s*:\s*ESSAY/i.test(textMatch);

                if (isNewSoal) {
                    if (currentSoal) soalArray.push(currentSoal);
                    currentSoal = { mapel, pertanyaan: '', opsi_a: '', opsi_b: '', opsi_c: '', opsi_d: '', opsi_e: '', kunci_jawaban: '', tipe_soal: 'PG' };
                    currentMode = 'Q'; currentQuestionNumber = num;
                    let clone = node.cloneNode(true);
                    stripPrefixFromDom(clone, /^\d+[\.\)]\s*/);
                    stripPrefixFromDom(clone, /^Soal\s+\d+\s*/i);
                    cleanEmptyTags(clone);
                    currentSoal.pertanyaan += clone.outerHTML;
                } else if (currentSoal) {
                    if (isOpsiA) { currentMode = 'A'; let c = node.cloneNode(true); stripPrefixFromDom(c, /^A[\.\)]\s*/i); cleanEmptyTags(c); currentSoal.opsi_a += c.outerHTML; }
                    else if (isOpsiB) { currentMode = 'B'; let c = node.cloneNode(true); stripPrefixFromDom(c, /^B[\.\)]\s*/i); cleanEmptyTags(c); currentSoal.opsi_b += c.outerHTML; }
                    else if (isOpsiC) { currentMode = 'C'; let c = node.cloneNode(true); stripPrefixFromDom(c, /^C[\.\)]\s*/i); cleanEmptyTags(c); currentSoal.opsi_c += c.outerHTML; }
                    else if (isOpsiD) { currentMode = 'D'; let c = node.cloneNode(true); stripPrefixFromDom(c, /^D[\.\)]\s*/i); cleanEmptyTags(c); currentSoal.opsi_d += c.outerHTML; }
                    else if (isOpsiE) { currentMode = 'E'; let c = node.cloneNode(true); stripPrefixFromDom(c, /^E[\.\)]\s*/i); cleanEmptyTags(c); currentSoal.opsi_e += c.outerHTML; }
                    else if (isKunci) { let kunciVal = textMatch.replace(/^Kunci\s*:\s*/i, '').trim().toUpperCase().charAt(0); currentSoal.kunci_jawaban = kunciVal; currentMode = null; }
                    else if (isTipe) { currentSoal.tipe_soal = 'ESSAY'; currentMode = null; }
                    else {
                        if (currentMode === 'Q') currentSoal.pertanyaan += node.outerHTML;
                        else if (currentMode === 'A') currentSoal.opsi_a += node.outerHTML;
                        else if (currentMode === 'B') currentSoal.opsi_b += node.outerHTML;
                        else if (currentMode === 'C') currentSoal.opsi_c += node.outerHTML;
                        else if (currentMode === 'D') currentSoal.opsi_d += node.outerHTML;
                        else if (currentMode === 'E') currentSoal.opsi_e += node.outerHTML;
                    }
                }
            });
            if (currentSoal) soalArray.push(currentSoal);
            if (soalArray.length === 0) {
                status.innerHTML = `<span style="color:red;"><i class="fas fa-times-circle"></i> Tidak ada soal yang ditemukan. Pastikan format penulisan sudah benar!</span>`;
                return;
            }
            status.innerHTML = `<span style="color:var(--primary);"><i class="fas fa-spinner fa-spin"></i> Menyimpan ${soalArray.length} soal ke database...</span>`;
            const { error } = await chunkedInsert('bank_soal', soalArray);
            if (error) throw error;
            status.innerHTML = `<span style="color:#10b981;"><i class="fas fa-check-circle"></i> Sukses! ${soalArray.length} soal untuk "${mapel}" dari Word berhasil disimpan.</span>`;
            document.getElementById('inputWord').value = '';
            await populatePreviewMapel();
            bukaDetailSoal(mapel);
        }).catch(function(err) { status.innerHTML = `<span style="color:red;"><i class="fas fa-exclamation-triangle"></i> Gagal mengekstrak Word: ${err.message}</span>`; });
    };
    reader.readAsArrayBuffer(file);
});

function analisisSoal() {
    bukaHalaman('analisis-soal-page', document.querySelector('[onclick*="analisis-soal-page"]'));
}
