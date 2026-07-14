// @ts-nocheck
// ============================================================
// admin-core.js — Core/Shared Functions for Admin SPA
// Loaded on EVERY page. Provides shared dependencies:
// - Supabase init, session management, auth
// - Page navigation (bukaHalaman) with lazy-load hook
// - Toast system, asyncConfirm, chunkedInsert
// - Realtime guru, heartbeat, clock, landing overlay logic
// - Global event listeners (visibilitychange, beforeunload)
// ============================================================

// --- SUPABASE INIT ---
const supabaseUrl = 'https://bkecjfrwqocguyvjymkn.supabase.co';
const supabaseKey = 'sb_publishable_4sQqxzUTiVhuf2h4SZCqNA_txpH0J8C';
const db = supabase.createClient(supabaseUrl, supabaseKey);

// --- LAZY LOAD SCRIPT HELPER ---
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Gagal memuat: ' + src));
        document.head.appendChild(s);
    });
}

// ==================== CHUNKED INSERT ====================
async function chunkedInsert(table, rows, chunkSize = 50) {
    const results = [];
    for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { data, error } = await adminDb.insert(table, chunk);
        if (error) return { error };
        results.push(data);
    }
    return { data: results };
}

// ==================== SESSION MANAGEMENT ====================
function upgradeSession() {
    const raw = localStorage.getItem('guru_session');
    if (!raw) return;
    try {
        const sesi = JSON.parse(raw);
        if (sesi && sesi.id && (!sesi.role || sesi.role === 'guru' && sesi.username === 'admin')) {
            db.from('guru').select('role').eq('id', sesi.id).maybeSingle().then(({ data: guruData }) => {
                if (guruData && guruData.role) {
                    sesi.role = guruData.role;
                    sesi.isAdmin = (guruData.role === 'admin');
                    localStorage.setItem('guru_session', JSON.stringify(sesi));
                }
            }).catch(() => {});
        }
    } catch (_) {}
}

function validasiSession() {
    try {
        const raw = localStorage.getItem('guru_session');
        if (!raw) return false;
        const s = JSON.parse(raw);
        if (!s.id || !s.nama || !s.username) return false;
        if (s.role && !['admin', 'guru', 'superadmin'].includes(s.role)) return false;
        if (!s.role) return false;
        if (s.created_at && new Date(s.created_at) > new Date()) return false;
        return true;
    } catch { return false; }
}

// ==================== TOAST SYSTEM ====================
const TOAST_DURATION = 6000;
const undoHistory = new Map();

function showToast(message, type = 'success', undoAction = null, undoLabel = 'Undo') {
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        info: 'fa-info-circle',
        aktif: 'fa-user-check',
        selesai: 'fa-check-circle',
        plg: 'fa-exclamation-triangle'
    };
    const container = document.getElementById('toast-container');
    const MAX_TOASTS = 4;
    if (container.children.length >= MAX_TOASTS) {
        const first = container.firstElementChild;
        if (first) {
            first.classList.remove('toast-show');
            first.classList.add('toast-hide');
            first.addEventListener('transitionend', () => {
                if (first.parentElement) first.remove();
            }, { once: true });
        }
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let contentHTML = `
        <div class="toast-content">
            <i class="fas ${icons[type] || 'fa-info-circle'}" style="flex-shrink:0; font-size:1.1rem;"></i>
            <span class="toast-message">${message}</span>
        </div>
    `;

    let undoId = null;
    if (undoAction && type === 'success') {
        undoId = 'undo_' + Date.now();
        contentHTML += `
            <div class="toast-actions">
                <button class="toast-btn" onclick="executeUndo('${undoId}')" style="color: #fcd34d;"><i class="fas fa-undo" style="margin-right:4px;"></i>${undoLabel}</button>
            </div>
        `;
    }

    toast.innerHTML = contentHTML + `
        <div class="toast-bar" style="animation: toastBarShrink ${TOAST_DURATION}ms linear forwards;"></div>
    `;
    container.appendChild(toast);

    if (undoId) {
        toast.dataset.undoId = undoId;
        undoHistory.set(undoId, { action: undoAction, toastElement: toast });
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => { toast.classList.add('toast-show'); });
    });

    const hideDelay = setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.remove('toast-show');
            toast.classList.add('toast-hide');
            toast.addEventListener('transitionend', () => {
                if (toast.parentElement) toast.remove();
                if (undoId) undoHistory.delete(undoId);
            }, { once: true });
        }
    }, TOAST_DURATION);

    const actions = toast.querySelector('.toast-actions');
    if (actions) {
        actions.addEventListener('click', (e) => {
            e.stopPropagation();
            clearTimeout(hideDelay);
        });
    }
}

function executeUndo(undoId) {
    const undoData = undoHistory.get(undoId);
    if (undoData) {
        const { action, toastElement } = undoData;
        action();
        if (toastElement && toastElement.parentElement) {
            toastElement.classList.remove('toast-show');
            toastElement.classList.add('toast-hide');
            toastElement.addEventListener('transitionend', () => {
                if (toastElement.parentElement) toastElement.remove();
            }, { once: true });
        }
        undoHistory.delete(undoId);
    }
}

// ==================== ASYNC CONFIRM ====================
function asyncConfirm(pesan, judul = 'Konfirmasi') {
    return new Promise((resolve) => {
        const modal = document.getElementById('modalConfirmAdmin');
        document.getElementById('admin-confirm-title').innerHTML = judul;
        document.getElementById('admin-confirm-text').innerHTML = pesan;

        const btnYes = document.getElementById('admin-confirm-btn-yes');
        const btnCancel = document.getElementById('admin-confirm-btn-cancel');

        const cleanup = () => {
            modal.classList.remove('show');
            btnYes.onclick = null;
            btnCancel.onclick = null;
        };

        btnYes.onclick = () => { cleanup(); resolve(true); };
        btnCancel.onclick = () => { cleanup(); resolve(false); };

        modal.classList.add('show');
    });
}

// ==================== REALTIME GURU ====================
let realtimeChannel = null;

function mulaiRealtimeGuru() {
    if (realtimeChannel) return;
    try {
        realtimeChannel = db.channel('guru-live-status')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'guru' },
                () => {
                    const tb = document.getElementById('guruTableBody');
                    if (tb && tb.offsetParent !== null) {
                        if (typeof loadGuruList === 'function') loadGuruList();
                    }
                }
            )
            .subscribe();
    } catch (e) {
        console.warn('⚠️ Realtime guru gagal, melanjutkan tanpa realtime:', e);
        realtimeChannel = null;
    }
}

function hentikanRealtimeGuru() {
    if (realtimeChannel) {
        db.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }
}

// ==================== GURU STATUS ONLINE & HEARTBEAT ====================
async function setGuruStatusOnline(guruId) {
    try {
        await adminDb.update('guru', guruId, { status: 'online', last_seen: new Date().toISOString() });
        try {
            await fetch('https://bkecjfrwqocguyvjymkn.supabase.co/rest/v1/rpc/guru_set_status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': supabaseKey },
                body: JSON.stringify({ p_guru_id: guruId, p_status: 'online' })
            });
        } catch (_) {}
    } catch (e) {
        console.warn('⏳ setGuruStatusOnline error:', e);
    }
}

let heartbeatInterval = null;

function mulaiHeartbeat(guruId) {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => { setGuruStatusOnline(guruId); }, 30000);
}

// ==================== AUTO-DEACTIVATE JADWAL (GLOBAL) ====================
let _autoDeactivateTimer = null;
let _watchedJadwal = [];
const _deactivatingIds = new Set();
let jadwalTimeout = null;

async function scheduleNextAutoDeactivate() {
    if (_autoDeactivateTimer) {
        clearTimeout(_autoDeactivateTimer);
        _autoDeactivateTimer = null;
    }
    try {
        const { data, error } = await db.from('jadwal_ujian').select('id, mapel, waktu_selesai, durasi_menit, waktu_mulai, is_aktif');
        if (error || !data) return;

        const now = new Date();
        const idsToDeactivate = [];
        const mapelToDeactivate = [];
        _watchedJadwal = [];
        let nextEndTime = Infinity;

        data.forEach(j => {
            const tMulai = j.waktu_mulai ? new Date(j.waktu_mulai) : null;
            let tSelesai = j.waktu_selesai ? new Date(j.waktu_selesai) : null;
            if (!tSelesai || isNaN(tSelesai.getTime())) {
                if (tMulai && !isNaN(tMulai.getTime())) {
                    tSelesai = new Date(tMulai.getTime() + (j.durasi_menit || 90) * 60000);
                } else return;
            }
            if (j.is_aktif === true && now >= tSelesai) {
                if (!_deactivatingIds.has(j.id)) {
                    _deactivatingIds.add(j.id);
                    idsToDeactivate.push(j.id);
                    mapelToDeactivate.push(j.mapel);
                }
            } else if (j.is_aktif === true && now < tSelesai) {
                _watchedJadwal.push({ id: j.id, mapel: j.mapel, endTime: tSelesai.getTime() });
                if (tSelesai.getTime() < nextEndTime) nextEndTime = tSelesai.getTime();
            }
        });

        if (idsToDeactivate.length > 0) {
            let updateError = null;
            for (const did of idsToDeactivate) {
                const { error: e } = await adminDb.update('jadwal_ujian', did, { is_aktif: false });
                if (e) updateError = e;
            }
            idsToDeactivate.forEach(id => _deactivatingIds.delete(id));
            if (updateError) {
                showToast('Gagal nonaktifkan jadwal otomatis: ' + updateError.message, 'error');
            } else {
                const mapelList = mapelToDeactivate.slice(0, 2).join(', ');
                const sisanya = mapelToDeactivate.length > 2 ? ` +${mapelToDeactivate.length - 2} lainnya` : '';
                showToast(`Waktu habis! "${mapelList}${sisanya}" dinonaktifkan otomatis`, 'info');
                _watchedJadwal = _watchedJadwal.filter(j => !idsToDeactivate.includes(j.id));
            }
        }

        if (nextEndTime !== Infinity) {
            const delayMs = Math.max(500, nextEndTime - Date.now() + 300);
            _autoDeactivateTimer = setTimeout(scheduleNextAutoDeactivate, delayMs);
        }
    } catch (err) {
        console.warn('[AutoDeactivate] Error:', err);
    }
}

let _safetyCheckIntervalId = setInterval(() => {
    if (_watchedJadwal.length === 0) return;
    const now = Date.now();
    if (_watchedJadwal.some(j => now >= j.endTime)) {
        scheduleNextAutoDeactivate();
    }
}, 10000);

// ==================== REALTIME CHANNELS (JADWAL & SOAL) ====================
let _jadwalRealtimeChannel = null;

function startJadwalRealtime() {
    if (_jadwalRealtimeChannel) { db.removeChannel(_jadwalRealtimeChannel); }
    _jadwalRealtimeChannel = db.channel('jadwal-realtime-watch')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'jadwal_ujian' },
            payload => {
                const overlay = document.getElementById('landingOverlay');
                if (overlay && typeof updateLandingTotalJadwal === 'function') updateLandingTotalJadwal();
                const prev = payload.old || {};
                const next = payload.new || {};
                const ev = payload.eventType;
                if (ev === 'UPDATE') {
                    if (prev.is_aktif === true && next.is_aktif === false) {
                        if (!_deactivatingIds.has(next.id)) {
                            showToast(`⏰ "${next.mapel}" dinonaktifkan otomatis`, 'info');
                        }
                        if (document.getElementById('jadwal') && document.getElementById('jadwal').classList.contains('active')) {
                            if (typeof loadJadwal === 'function') loadJadwal();
                        }
                        if (typeof updateDashboardStats === 'function') updateDashboardStats();
                        if (typeof loadDashboardJadwalAktif === 'function') loadDashboardJadwalAktif();
                        scheduleNextAutoDeactivate();
                    } else if (prev.is_aktif === false && next.is_aktif === true) {
                        scheduleNextAutoDeactivate();
                        if (typeof updateDashboardStats === 'function') updateDashboardStats();
                        if (typeof loadDashboardJadwalAktif === 'function') loadDashboardJadwalAktif();
                        if (document.getElementById('jadwal') && document.getElementById('jadwal').classList.contains('active')) {
                            if (typeof loadJadwal === 'function') loadJadwal();
                        }
                    }
                } else if (ev === 'INSERT' || ev === 'DELETE') {
                    scheduleNextAutoDeactivate();
                    if (typeof updateDashboardStats === 'function') updateDashboardStats();
                    if (typeof loadDashboardJadwalAktif === 'function') loadDashboardJadwalAktif();
                    if (document.getElementById('jadwal') && document.getElementById('jadwal').classList.contains('active')) {
                        if (typeof loadJadwal === 'function') loadJadwal();
                    }
                }
            }
        )
        .subscribe(() => {});
}

let _soalRealtimeChannel = null;

function startSoalRealtime() {
    if (_soalRealtimeChannel) { db.removeChannel(_soalRealtimeChannel); }
    _soalRealtimeChannel = db.channel('soal-realtime-watch')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'bank_soal' },
            () => {
                const overlay = document.getElementById('landingOverlay');
                if (overlay && typeof updateLandingTotalSoal === 'function') updateLandingTotalSoal();
                if (typeof updateDashboardStats === 'function') updateDashboardStats();
                if (document.getElementById('bank-soal') && document.getElementById('bank-soal').classList.contains('active')) {
                    if (typeof populatePreviewMapel === 'function') populatePreviewMapel();
                    if (typeof loadPreviewSoal === 'function') loadPreviewSoal();
                }
            }
        )
        .subscribe(() => {});
}

// ==================== CLOCK ====================
function updateJam() {
    const elJam = document.getElementById('jam-sekarang');
    const elTgl = document.getElementById('tanggal-sekarang');
    const now = new Date();
    if (elJam) elJam.innerText = now.toLocaleTimeString('id-ID');
    if (elTgl) {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        elTgl.innerText = now.toLocaleDateString('id-ID', options);
    }
}
let _updateJamIntervalId = setInterval(updateJam, 1000);
updateJam();

// ==================== PAGE NAVIGATION WITH LAZY LOAD ====================
function updateWelcomeGreeting() {
    const sesi = getGuruSession();
    if (sesi) {
        const nama = sesi.nama || sesi.username || 'Pengguna';
        const elWelcome = document.getElementById('welcome-user-name');
        if (elWelcome) elWelcome.textContent = nama;
        const elHeaderName = document.getElementById('header-user-name-text');
        if (elHeaderName) elHeaderName.textContent = nama;
    }
    const elDate = document.getElementById('welcome-date');
    if (elDate) {
        const now = new Date();
        const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        elDate.textContent = now.toLocaleDateString('id-ID', opts);
    }
}

function pasangNavigasiRole() {
    const sesi = getGuruSession();
    const isAdmin = sesi && sesi.isAdmin === true;
    const navAkunGuru = document.getElementById('nav-akun-guru');
    if (navAkunGuru) navAkunGuru.style.display = isAdmin ? '' : 'none';

    const spanRole = document.getElementById('role-badge');
    const spanRoleText = document.getElementById('role-badge-text');
    if (spanRole) {
        spanRole.style.color = isAdmin ? '#fbbf24' : '#93c5fd';
        spanRole.style.background = isAdmin ? 'rgba(245, 158, 11, 0.15)' : 'rgba(59, 130, 246, 0.12)';
        spanRole.style.borderColor = isAdmin ? 'rgba(245, 158, 11, 0.3)' : 'rgba(59, 130, 246, 0.25)';
    }
    if (spanRoleText) spanRoleText.textContent = isAdmin ? 'Admin' : 'Guru';

    const headerName = document.getElementById('header-user-name');
    const headerLogout = document.getElementById('header-logout-btn');
    if (headerName) headerName.style.display = sesi ? 'flex' : 'none';
    if (headerLogout) headerLogout.style.display = sesi ? 'inline-flex' : 'none';

    const welcomeBadge = document.getElementById('welcome-role-badge');
    if (welcomeBadge) {
        welcomeBadge.style.background = isAdmin ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.12)';
        welcomeBadge.style.borderColor = isAdmin ? 'rgba(245,158,11,0.25)' : 'rgba(59,130,246,0.25)';
        welcomeBadge.style.color = isAdmin ? '#fbbf24' : '#93c5fd';
        welcomeBadge.innerHTML = '<i class="fas fa-shield-halved"></i> ' + (isAdmin ? 'Admin' : 'Guru');
    }
}

function bukaHalaman(idHalaman, elemenTombol) {
    // Access control: only admin can view akun-guru
    if (idHalaman === 'akun-guru') {
        const sesi = getGuruSession();
        if (!sesi || sesi.isAdmin !== true) {
            showToast('Akses ditolak. Halaman ini hanya untuk Admin.', 'error');
            const dashboardBtn = document.querySelector('.nav-btn[onclick*="dashboard"]');
            if (dashboardBtn) bukaHalaman('dashboard', dashboardBtn);
            return;
        }
    }

    document.querySelectorAll('.page-section').forEach(page => page.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(idHalaman).classList.add('active');
    if (elemenTombol) elemenTombol.classList.add('active');

    const judul = {
        'dashboard': 'Dashboard Overview',
        'bank-soal': 'Manajemen Bank Soal',
        'jadwal': 'Pengaturan Jadwal Ujian',
        'monitoring': '🔴 Live Monitoring Ujian',
        'laporan': 'Laporan Hasil Ujian Siswa',
        'analisis-soal-page': 'Analisis Statistik & Butir Soal',
        'akun-guru': 'Pusat Akun Guru'
    };
    const judulEl = document.getElementById('judul-halaman');
    if (judulEl) judulEl.innerText = judul[idHalaman] || '';

    const banner = document.getElementById('mon-status-banner');
    if (banner) banner.style.display = 'none';

    if (jadwalTimeout) {
        clearTimeout(jadwalTimeout);
        jadwalTimeout = null;
    }

    // --- LAZY LOAD MODULE SCRIPTS ---
    const moduleMap = {
        'dashboard': 'admin-dashboard.js',
        'bank-soal': 'admin-soal.js',
        'jadwal': 'admin-jadwal.js',
        'monitoring': 'admin-monitoring.js',
        'laporan': 'admin-laporan.js',
        'analisis-soal-page': 'admin-analisis.js',
        'akun-guru': 'admin-guru.js'
    };
    const scriptName = moduleMap[idHalaman];
    if (scriptName && typeof window[`__${scriptName.replace('.js', '')}_loaded`] === 'undefined') {
        loadScript(`admin/js/${scriptName}`).then(() => {
            window[`__${scriptName.replace('.js', '')}_loaded`] = true;
            // After load, call the init function
            initPage(idHalaman);
        }).catch(err => {
            console.error(`Failed to load ${scriptName}:`, err);
        });
    } else {
        initPage(idHalaman);
    }
}

function initPage(idHalaman) {
    if (idHalaman === 'dashboard') {
        updateWelcomeGreeting();
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
        if (typeof loadDashboardJadwalAktif === 'function') loadDashboardJadwalAktif();
        if (typeof loadRecentActivity === 'function') loadRecentActivity();
    }
    if (idHalaman === 'laporan') {
        if (typeof initCustomSelect === 'function') {
            initCustomSelect('filter-mapel-laporan');
            initCustomSelect('filter-kelas-laporan');
        }
        if (typeof loadNilaiSiswa === 'function') loadNilaiSiswa();
    }
    if (idHalaman === 'jadwal') {
        if (typeof populateJadwalMapelDropdown === 'function') populateJadwalMapelDropdown();
        if (typeof loadJadwal === 'function') loadJadwal();
    }
    if (idHalaman === 'bank-soal') {
        if (typeof populatePreviewMapel === 'function') populatePreviewMapel();
        if (typeof loadMathJax === 'function') loadMathJax();
        // Load AI generator module
        if (typeof AIGenerator === 'undefined') {
            loadScript('admin/js/admin-ai.js');
        }
    }
    if (idHalaman === 'analisis-soal-page') {
        if (typeof initCustomSelect === 'function') {
            initCustomSelect('ana-filter-mapel');
            initCustomSelect('ana-filter-kelas');
        }
        if (typeof populateAnalisisFilters === 'function') populateAnalisisFilters();
    }
    if (idHalaman === 'monitoring') {
        if (typeof initCustomSelect === 'function') {
            initCustomSelect('filter-mapel-monitoring');
            initCustomSelect('filter-kelas-monitoring');
        }
        if (typeof startRealtimeMonitoring === 'function') startRealtimeMonitoring();
        if (typeof populateFilterKelas === 'function') populateFilterKelas().then(() => {
            if (typeof loadMonitoring === 'function') loadMonitoring();
        });
    }
    if (idHalaman === 'akun-guru') {
        mulaiRealtimeGuru();
        if (typeof loadDataGuru === 'function') loadDataGuru();
        if (typeof mulaiPollingGuru === 'function') mulaiPollingGuru();
    } else {
        if (typeof hentikanPollingGuru === 'function') hentikanPollingGuru();
    }

    scheduleNextAutoDeactivate();
}

// ==================== ENTER DASHBOARD ====================
let isEnteringDashboard = false;

function enterDashboard(btn) {
    if (isEnteringDashboard) return;
    isEnteringDashboard = true;

    if (!validasiSession()) {
        isEnteringDashboard = false;
        localStorage.removeItem('guru_session');
        Swal.fire({ icon: 'error', title: 'Sesi Tidak Valid', text: 'Session Anda telah kedaluwarsa atau dimanipulasi. Silakan login ulang.', background: 'rgba(15,23,42,0.95)', color: '#f1f5f9', confirmButtonColor: '#3b82f6' });
        return;
    }

    const overlay = document.getElementById('landingOverlay');
    if (overlay) {
        overlay.style.display = 'none';
        overlay.classList.add('hidden');
        setTimeout(() => { try { overlay.remove(); } catch (_) {} }, 900);
    }

    const dashboardBtn = document.querySelector('.nav-btn[onclick*="dashboard"]');
    if (dashboardBtn) bukaHalaman('dashboard', dashboardBtn);

    try {
        if (btn) {
            const ripple = document.createElement('span');
            ripple.className = 'ripple';
            ripple.style.width = ripple.style.height = '100px';
            ripple.style.left = '50%';
            ripple.style.top = '50%';
            ripple.style.marginLeft = '-50px';
            ripple.style.marginTop = '-50px';
            btn.appendChild(ripple);
            btn.classList.add('clicked');
            setTimeout(() => ripple.remove(), 600);
        }
        updateWelcomeGreeting();
        pasangNavigasiRole();
        mulaiRealtimeGuru();
        if (typeof playWelcomeSound === 'function') {
            playWelcomeSound().catch(err => console.warn('🔊 Welcome sound failed:', err));
        }
    } catch (e) {
        console.warn('⚠️ enterDashboard non-critical error:', e);
    }
}

// ==================== LANDING PAGE ====================
function initLandingSlideshow() {
    let currentSlide = 0;
    let slideInterval;
    const slides = document.querySelectorAll('.feature-slide');
    const dots = document.querySelectorAll('.feature-dots .dot');
    if (slides.length === 0) return;

    function showSlide(idx) {
        slides.forEach((s, i) => {
            if (i === idx) s.classList.add('active');
            else s.classList.remove('active');
        });
        dots.forEach((d, i) => {
            if (i === idx) d.classList.add('active');
            else d.classList.remove('active');
        });
        currentSlide = idx;
    }

    window.setSlide = function(idx) {
        showSlide(idx);
        clearInterval(slideInterval);
        startInterval();
    };

    function startInterval() {
        slideInterval = setInterval(() => {
            let next = (currentSlide + 1) % slides.length;
            showSlide(next);
        }, 3500);
    }
    startInterval();
}

function animateCounter(id, targetValue) {
    const el = document.getElementById(id);
    if (!el) return;
    let start = parseInt(el.innerText) || 0;
    let duration = 800;
    let startTime = null;
    function step(timestamp) {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / duration, 1);
        const easeProgress = 1 - Math.pow(1 - progress, 3);
        el.innerText = Math.floor(start + easeProgress * (targetValue - start));
        if (progress < 1) window.requestAnimationFrame(step);
        else el.innerText = targetValue;
    }
    window.requestAnimationFrame(step);
}

async function updateLandingSiswaAktif() {
    try {
        const { data: siswaData } = await db.from('jawaban_ujian').select('status');
        let activeCount = 0;
        if (siswaData) activeCount = siswaData.filter(s => !String(s.status).startsWith('SELESAI')).length;
        animateCounter('landing-siswa-aktif', activeCount);
    } catch (e) {
        console.error('❌ Gagal memperbarui statistik siswa aktif di landing page:', e);
    }
}

async function updateLandingTotalSoal() {
    try {
        const { count: totalSoal } = await db.from('bank_soal').select('*', { count: 'exact', head: true });
        animateCounter('landing-total-soal', totalSoal || 0);
    } catch (e) {
        console.error('❌ Gagal memperbarui statistik total bank soal di landing page:', e);
    }
}

async function updateLandingTotalJadwal() {
    try {
        const { count: totalJadwal } = await db.from('jadwal_ujian').select('*', { count: 'exact', head: true });
        animateCounter('landing-total-jadwal', totalJadwal || 0);
    } catch (e) {
        console.error('❌ Gagal memperbarui statistik total jadwal di landing page:', e);
    }
}

async function fetchLandingStats() {
    try {
        await Promise.all([updateLandingSiswaAktif(), updateLandingTotalSoal(), updateLandingTotalJadwal()]);
    } catch (e) {
        console.error('❌ Failed to fetch landing statistics:', e);
    }
}

// ==================== AUTH FUNCTIONS ====================
function bukaLoginModal() {
    document.getElementById('adminLoginUsername').value = '';
    document.getElementById('adminLoginPassword').value = '';
    document.getElementById('loginModalError').textContent = '';
    document.getElementById('btnLoginSubmit').disabled = false;
    document.getElementById('btnLoginSubmit').innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Masuk Dashboard';
    document.getElementById('loginModalOverlay').classList.add('show');
    setTimeout(() => document.getElementById('adminLoginUsername').focus(), 300);
}

function tutupLoginModal() {
    document.getElementById('loginModalOverlay').classList.remove('show');
}

async function adminLogin() {
    const username = document.getElementById('adminLoginUsername').value.trim();
    const password = document.getElementById('adminLoginPassword').value;
    const errEl = document.getElementById('loginModalError');
    if (!username || !password) { errEl.textContent = 'Masukkan username dan password'; return; }
    errEl.textContent = '';
    const btn = document.getElementById('btnLoginSubmit');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memproses...';
    try {
        const { data, error } = await db.rpc('guru_login', { p_username: username, p_password: password });
        if (error || !data || !data.success) {
            errEl.textContent = error ? error.message : (data && data.error ? data.error : 'Login gagal');
            btn.disabled = false; btn.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Masuk Dashboard';
            return;
        }
        const sessionData = data.data;
        sessionData.role = sessionData.role || 'guru';
        sessionData.isAdmin = (sessionData.role === 'admin');
        localStorage.setItem('guru_session', JSON.stringify(sessionData));
        sessionStorage.setItem('guru_session_backup', JSON.stringify(sessionData));

        const namaLengkap = sessionData.nama || sessionData.username;
        const elWelcome = document.getElementById('welcome-user-name');
        if (elWelcome) elWelcome.textContent = namaLengkap;
        const elHeaderName = document.getElementById('header-user-name-text');
        if (elHeaderName) elHeaderName.textContent = namaLengkap;

        pasangNavigasiRole();
        setGuruStatusOnline(sessionData.id).catch(e => console.warn('Status online fail:', e));
        mulaiHeartbeat(sessionData.id);
        mulaiRealtimeGuru();
        tutupLoginModal();
        const landingBtn = document.getElementById('btnMasuk');
        enterDashboard(landingBtn);
    } catch (e) {
        errEl.textContent = e.message || 'Terjadi kesalahan';
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Masuk Dashboard';
    }
}

function logoutGuru() {
    Swal.fire({
        title: 'Yakin keluar?',
        text: 'Anda akan keluar dari panel admin',
        icon: 'question', showCancelButton: true, confirmButtonColor: '#EF4444', cancelButtonColor: '#6B7280',
        confirmButtonText: 'Ya, Keluar', cancelButtonText: 'Batal',
        background: 'rgba(15,23,42,0.95)', color: '#f1f5f9'
    }).then(async (res) => {
        if (res.isConfirmed) {
            const sesi = getGuruSession();
            if (sesi && sesi.id) {
                try { await adminDb.update('guru', sesi.id, { status: 'offline', last_seen: new Date().toISOString() }); } catch (_) {}
            }
            // Cleanup all channels & intervals
            if (typeof monitoringChannel !== 'undefined' && monitoringChannel) { db.removeChannel(monitoringChannel); monitoringChannel = null; }
            if (_jadwalRealtimeChannel) { db.removeChannel(_jadwalRealtimeChannel); _jadwalRealtimeChannel = null; }
            if (_soalRealtimeChannel) { db.removeChannel(_soalRealtimeChannel); _soalRealtimeChannel = null; }
            if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
            if (_updateJamIntervalId) { clearInterval(_updateJamIntervalId); _updateJamIntervalId = null; }
            if (_safetyCheckIntervalId) { clearInterval(_safetyCheckIntervalId); _safetyCheckIntervalId = null; }
            if (_autoDeactivateTimer) { clearTimeout(_autoDeactivateTimer); _autoDeactivateTimer = null; }
            if (window._monDebounce) { clearTimeout(window._monDebounce); window._monDebounce = null; }
            hentikanRealtimeGuru();
            localStorage.removeItem('guru_session');
            location.reload();
        }
    });
}

// ==================== GURU POLLING ====================
let _guruPollTimer = null;

function mulaiPollingGuru() {
    if (_guruPollTimer) clearInterval(_guruPollTimer);
    _guruPollTimer = setInterval(() => {
        const tb = document.getElementById('guruTableBody');
        if (tb && tb.offsetParent !== null && typeof loadGuruList === 'function') {
            loadGuruList();
        }
    }, 15000);
}

function hentikanPollingGuru() {
    if (_guruPollTimer) { clearInterval(_guruPollTimer); _guruPollTimer = null; }
}

// ==================== GLOBAL VARIABLES & PAGINATION ====================
let globalDataJawaban = [];
let lastActivityId = null;
let currentMonPage = 1;
let currentMonStatus = 'ALL';
let currentLapPage = 1;
const ITEMS_PER_PAGE = 50;

function setMonStatus(status) {
    currentMonStatus = status;
    const cards = {
        'AKTIF': document.getElementById('mon-card-aktif'),
        'SELESAI': document.getElementById('mon-card-selesai'),
        'PELANGGARAN': document.getElementById('mon-card-pelanggaran')
    };
    Object.values(cards).forEach(card => {
        if (card) {
            card.style.borderWidth = '2px';
            card.style.background = card === cards[status] ?
                (status === 'AKTIF' ? 'rgba(16, 185, 129, 0.1)' : status === 'SELESAI' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)')
                : (status === 'AKTIF' ? 'rgba(16, 185, 129, 0.04)' : status === 'SELESAI' ? 'rgba(59, 130, 246, 0.04)' : 'rgba(239, 68, 68, 0.04)');
        }
    });
    if (cards[status]) cards[status].style.borderWidth = '3px';
    currentMonPage = 1;
    if (typeof loadMonitoring === 'function') loadMonitoring();
}

function changeMonPage(delta) {
    currentMonPage += delta;
    if (currentMonPage < 1) currentMonPage = 1;
    if (typeof loadMonitoring === 'function') loadMonitoring();
}

function changeLapPage(delta) {
    currentLapPage += delta;
    if (currentLapPage < 1) currentLapPage = 1;
    if (typeof loadNilaiSiswa === 'function') loadNilaiSiswa();
}

// ==================== SORT STATE ====================
const sortState = {
    monitoring: { column: null, direction: 'asc' },
    laporan: { column: null, direction: 'asc' }
};
let tempMonitoringData = [];
let tempLaporanData = [];

// ==================== TOGGLE SELECT ALL ====================
function toggleSelectAll(type) {
    const isChecked = document.getElementById('select-all-' + type).checked;
    const selector = type === 'jadwal' ? '.cb-jadwal' : (type === 'laporan' ? '.cb-laporan' : (type === 'mapel' ? '.cb-mapel' : (type === 'monitoring' ? '.cb-monitoring' : '.cb-soal')));
    document.querySelectorAll(selector).forEach(cb => cb.checked = isChecked);
}

// ==================== EVENT LISTENERS ====================
// beforeunload — set guru offline
window.addEventListener('beforeunload', () => {
    const sesi = getGuruSession();
    if (sesi && sesi.id) {
        try {
            fetch('https://bkecjfrwqocguyvjymkn.supabase.co/rest/v1/rpc/guru_set_status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': supabaseKey },
                body: JSON.stringify({ p_guru_id: sesi.id, p_status: 'offline' }),
                keepalive: true
            });
        } catch (_) {}
        try { adminDb.update('guru', sesi.id, { status: 'offline', last_seen: new Date().toISOString() }).catch(() => {}); } catch (_) {}
    }
});

// visibilitychange — refresh UI when tab comes back
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        try {
            const ls = localStorage.getItem('guru_session');
            const ss = sessionStorage.getItem('guru_session_backup');
            if (ls && ss && ls !== ss) {
                localStorage.removeItem('guru_session');
                sessionStorage.removeItem('guru_session_backup');
                window.location.reload();
                return;
            }
            if (ls && !validasiSession()) {
                localStorage.removeItem('guru_session');
                sessionStorage.removeItem('guru_session_backup');
                window.location.reload();
                return;
            }
        } catch (_) {}
        Promise.all([
            Promise.resolve(updateJam()),
            typeof updateDashboardStats === 'function' ? updateDashboardStats() : Promise.resolve(),
            typeof loadDashboardJadwalAktif === 'function' ? loadDashboardJadwalAktif() : Promise.resolve(),
            typeof loadRecentActivity === 'function' ? loadRecentActivity() : Promise.resolve(),
            typeof scheduleNextAutoDeactivate === 'function' ? scheduleNextAutoDeactivate() : Promise.resolve()
        ]).catch(err => console.warn('visibilitychange refresh warning:', err));
    }
});

// Click outside custom select
document.addEventListener('click', function(e) {
    if (!e.target.closest('.csl-container')) {
        document.querySelectorAll('.csl-dropdown.show').forEach(d => {
            d.classList.remove('show');
            d.parentNode.querySelector('.csl-btn').classList.remove('open');
        });
    }
});

// Touch device optimization
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    document.querySelectorAll('.landing-orb').forEach(el => {
        el.style.animation = 'none';
        el.style.opacity = '0.05';
    });
}

// Upgrade session on load
(async () => { try { await upgradeSession(); } catch (_) {} })();

// Initialization
scheduleNextAutoDeactivate();
if (typeof loadNilaiSiswa === 'function') loadNilaiSiswa();
if (typeof updateDashboardStats === 'function') updateDashboardStats();
if (typeof loadDashboardJadwalAktif === 'function') loadDashboardJadwalAktif();
if (typeof loadRecentActivity === 'function') loadRecentActivity();
initLandingSlideshow();
fetchLandingStats();
if (typeof startRealtimeMonitoring === 'function') startRealtimeMonitoring();
startJadwalRealtime();
startSoalRealtime();

// Sidebar toggle
document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('collapsed');
});
