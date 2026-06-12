// @ts-nocheck
// ============================================================
// admin-dashboard.js — Dashboard Section
// Functions: updateDashboardStats, loadDashboardJadwalAktif,
//            loadRecentActivity, playWelcomeSound
// ============================================================

async function updateDashboardStats() {
    const { data: siswa } = await db.from('jawaban_ujian').select('id');
    if (siswa) document.getElementById('tot-siswa').innerText = siswa.length + " Orang";

    const { count: jmlSoal } = await db.from('bank_soal').select('*', { count: 'exact', head: true });
    document.getElementById('tot-soal').innerText = jmlSoal || 0;

    const { data: nilai } = await db.from('jawaban_ujian').select('skor_pg');
    if (nilai && nilai.length > 0) {
        const total = nilai.reduce((acc, curr) => acc + Number(curr.skor_pg || 0), 0);
        const rata = (total / nilai.length).toFixed(1);
        document.getElementById('rata-nilai').innerText = rata;
    }

    const now = new Date().toISOString();
    const { count: activeCount } = await db.from('jadwal_ujian')
        .select('*', { count: 'exact', head: true })
        .eq('is_aktif', true)
        .lte('waktu_mulai', now)
        .gte('waktu_selesai', now);

    const elActive = document.getElementById('tot-aktif');
    if (elActive) elActive.innerText = activeCount || 0;
}

async function loadDashboardJadwalAktif() {
    const container = document.getElementById('dashboard-jadwal-aktif');
    const now = new Date();
    const { data, error } = await db.from('jadwal_ujian').select('*').eq('is_aktif', true);

    const activeNow = data ? data.filter(j => now >= new Date(j.waktu_mulai) && now <= new Date(j.waktu_selesai)) : [];

    if (error || activeNow.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted); background:rgba(255,255,255,0.02); border-radius:12px; border:1px dashed var(--border);">
            <i class="fas fa-coffee" style="font-size:24px; margin-bottom:10px; display:block; opacity:0.5;"></i>
            Tidak ada ujian yang sedang aktif saat ini.
        </div>`;
        return;
    }

    let html = '';
    activeNow.forEach(j => {
        let kelasStr = j.kelas || "Semua Kelas";
        if (kelasStr.includes('::')) {
            const p = kelasStr.split('::');
            kelasStr = `<span style="color:var(--primary); font-weight:700;">${p[0]}</span> - ${p[1]}`;
        }
        const tMulai = new Date(j.waktu_mulai);
        const tSelesai = new Date(j.waktu_selesai);

        html += `
            <div style="background:rgba(16, 185, 129, 0.03); border:1px solid rgba(16, 185, 129, 0.15); border-radius:12px; padding:15px; margin-bottom:12px; transition:all 0.3s; border-left:4px solid #10b981; backdrop-filter:blur(6px);">
                <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:8px;">
                    <strong style="color:var(--text-main); font-size:15px;">${j.mapel}</strong>
                    <span class="badge" style="background:rgba(16, 185, 129, 0.15); color:#34d399; border:1px solid rgba(16, 185, 129, 0.3); font-size:10px;">LIVE</span>
                </div>
                <div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">
                    <i class="fas fa-users" style="width:16px;"></i> ${kelasStr}
                </div>
                <div style="display:flex; align-items:center; gap:15px; font-size:11px; color:var(--text-muted); font-weight:600; padding-top:8px; border-top:1px solid var(--border);">
                    <span><i class="fas fa-clock"></i> Selesai: ${tSelesai.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span style="color:#f87171;"><i class="fas fa-circle fa-beat"></i> Sedang Berjalan</span>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

async function loadRecentActivity() {
    const container = document.getElementById('dashboard-recent-activity');
    const { data, error } = await db.from('jawaban_ujian')
        .select('*')
        .like('status', 'SELESAI%')
        .order('id', { ascending: false })
        .limit(6);

    if (error || !data || data.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">Belum ada siswa yang selesai.</div>';
        return;
    }

    let html = '';
    data.forEach(s => {
        let waktuLabel = '';
        const matchWaktu = (s.status || '').match(/SELESAI - (.+)/);
        if (matchWaktu) {
            waktuLabel = matchWaktu[1].substring(0, 5);
        } else {
            waktuLabel = new Date(s.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        }

        const isPlg = parseInt(s.pelanggaran) > 0;
        const skor = s.skor_pg !== null && s.skor_pg !== undefined ? s.skor_pg : '—';

        html += `
            <div style="display:flex; align-items:center; gap:12px; padding:11px 0; border-bottom:1px solid #f1f5f9; animation: fadeIn 0.4s ease;">
                <div style="width:38px; height:38px; background:${isPlg ? '#fef2f2' : '#eff6ff'}; border-radius:50%; display:flex; align-items:center; justify-content:center; color:${isPlg ? '#ef4444' : 'var(--primary)'}; font-size:14px; flex-shrink:0;">
                    <i class="fas fa-user-check"></i>
                </div>
                <div style="flex:1; overflow:hidden; min-width:0;">
                    <div style="font-size:13px; font-weight:700; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${s.nama}</div>
                    <div style="font-size:11px; color:var(--text-muted); margin-top:1px;">${s.mapel} • ${s.kelas}</div>
                </div>
                <div style="text-align:right; flex-shrink:0;">
                    <div style="font-size:12px; color:var(--primary); font-weight:700;">${waktuLabel}</div>
                    <div style="font-size:11px; font-weight:600; color:#10b981; margin-top:2px;">✓ Selesai</div>
                    ${isPlg ? `<div style="font-size:10px; color:#ef4444; font-weight:600;">🚨 ${s.pelanggaran} Pelanggaran</div>` : ''}
                    <div style="font-size:10px; color:var(--text-muted); margin-top:1px;">Skor: <b style="color:var(--text-main)">${skor}</b></div>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

async function playWelcomeSound() {
    console.log('🔊 Attempting to play welcome sound...');
    if (typeof Tone === 'undefined') {
        try {
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js');
        } catch (e) {
            console.warn('🔊 Gagal memuat Tone.js, suara dilewati.');
            return;
        }
    }
    try {
        await Tone.start();
        const vol = new Tone.Volume(-6).toDestination();
        const reverb = new Tone.Reverb({ decay: 5, preDelay: 0.2, wet: 0.5 }).connect(vol);
        await reverb.generate();

        const pad = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: 'sine' },
            envelope: { attack: 1.5, decay: 2, sustain: 0.5, release: 4 },
            volume: -10
        }).connect(reverb);

        const bell = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: 'sine' },
            envelope: { attack: 0.05, decay: 2, sustain: 0, release: 2.5 },
            volume: -6
        }).connect(reverb);

        const sub = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 2, decay: 2, sustain: 0.3, release: 3 },
            volume: -14
        }).connect(reverb);

        const now = Tone.now();
        sub.triggerAttackRelease('D2', 5, now);
        pad.triggerAttackRelease(['D3', 'F#3', 'A3'], 4, now + 0.2);
        bell.triggerAttackRelease('D5', 1.5, now + 0.6);
        bell.triggerAttackRelease('F#5', 1.5, now + 1.2);
        bell.triggerAttackRelease('A5', 2.5, now + 1.8);
    } catch (e) {
        console.error('❌ Audio fail:', e);
    }
}
