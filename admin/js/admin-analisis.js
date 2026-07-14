// @ts-nocheck
// ============================================================
// admin-analisis.js — Analisis Soal Section
// Functions: loadAnalisisData, loadAnalisisSoal, renderChart,
//            renderDistribusi, renderTingkatKesulitan,
//            populateAnalisisFilters, analisisSoal
// ============================================================

let myChart = null;

async function populateAnalisisFilters() {
    const selectMapel = document.getElementById('ana-filter-mapel');
    const selectKelas = document.getElementById('ana-filter-kelas');
    const sesi = getGuruSession();
    const isAdmin = sesi && sesi.isAdmin === true;
    const guruId = sesi ? sesi.id : null;

    let mapelFilter = null;
    if (!isAdmin && guruId) {
        const { data: mySoal } = await db.from('bank_soal').select('mapel').eq('created_by', guruId);
        if (mySoal) mapelFilter = [...new Set(mySoal.map(d => d.mapel))];
    }

    let data;
    if (mapelFilter && mapelFilter.length > 0) {
        const { data: d } = await db.from('jawaban_ujian').select('mapel, kelas').in('mapel', mapelFilter);
        data = d;
    } else if (!mapelFilter) {
        const { data: d } = await db.from('jawaban_ujian').select('mapel, kelas');
        data = d;
    } else {
        data = [];
    }
    if (!data) return;

    const mapels = [...new Set(data.map(d => d.mapel))].sort();
    const kelass = [...new Set(data.map(d => d.kelas))].sort();

    const curM = selectMapel.value;
    const curK = selectKelas.value;

    selectMapel.innerHTML = '<option value="">Semua Mapel</option>';
    mapels.forEach(m => { selectMapel.innerHTML += `<option value="${m}">${m}</option>`; });

    selectKelas.innerHTML = '<option value="">Semua Kelas</option>';
    kelass.forEach(k => { const textK = k.includes('::') ? k.split('::')[1] : k; selectKelas.innerHTML += `<option value="${k}">${textK}</option>`; });

    selectMapel.value = curM;
    selectKelas.value = curK;

    if (typeof initCustomSelect === 'function') {
        initCustomSelect('ana-filter-mapel');
        initCustomSelect('ana-filter-kelas');
    }
    if (typeof syncCustomSelect === 'function') {
        syncCustomSelect('ana-filter-mapel');
        syncCustomSelect('ana-filter-kelas');
    }

    loadAnalisisData();
}

async function loadAnalisisSoal() { return loadAnalisisData(); }

async function loadAnalisisData() {
    const mapel = document.getElementById('ana-filter-mapel').value;
    const kelas = document.getElementById('ana-filter-kelas').value;
    const sesi = getGuruSession();
    const isAdmin = sesi && sesi.isAdmin === true;

    if (!mapel) return;

    // Guru: hanya bisa analisis mapel miliknya
    if (!isAdmin) {
        const { data: cek } = await db.from('bank_soal').select('id').eq('mapel', mapel).eq('created_by', sesi.id).limit(1);
        if (!cek || cek.length === 0) {
            document.getElementById('ana-rata').innerText = '-';
            document.getElementById('ana-tinggi').innerText = '-';
            document.getElementById('ana-rendah').innerText = '-';
            if (myChart) myChart.destroy();
            document.getElementById('tabel-analisis-soal').innerHTML = '<tr><td colspan="5" style="padding:30px;text-align:center;">Anda hanya bisa menganalisis mapel yang Anda buat.</td></tr>';
            document.getElementById('ana-total-soal').innerText = 'Total: 0 Soal';
            return;
        }
    }

    // 1. Statistik Nilai
    let queryNilai = db.from('jawaban_ujian').select('*').eq('mapel', mapel);
    if (kelas) queryNilai = queryNilai.eq('kelas', kelas);
    const { data: dataNilai } = await queryNilai;

    if (dataNilai && dataNilai.length > 0) {
        const skor = dataNilai.map(s => Number(s.skor_pg || 0));
        document.getElementById('ana-rata').innerText = (skor.reduce((a, b) => a + b, 0) / skor.length).toFixed(1);
        document.getElementById('ana-tinggi').innerText = Math.max(...skor);
        document.getElementById('ana-rendah').innerText = Math.min(...skor);
        renderChart(skor);
    } else {
        document.getElementById('ana-rata').innerText = "-";
        document.getElementById('ana-tinggi').innerText = "-";
        document.getElementById('ana-rendah').innerText = "-";
        if (myChart) myChart.destroy();
    }

    // 2. Butir Soal
    const { data: dataSoal } = await db.from('bank_soal').select('*').eq('mapel', mapel).order('id', { ascending: true });
    const tbody = document.getElementById('tabel-analisis-soal');
    document.getElementById('ana-total-soal').innerText = `Total: ${dataSoal ? dataSoal.length : 0} Soal`;

    if (dataSoal && dataSoal.length > 0) {
        tbody.innerHTML = '';
        dataSoal.forEach((s, i) => {
            const randomPct = Math.floor(Math.random() * 40) + 60; // Mock data
            let badgeColor = '#10b981', status = 'Mudah';
            if (randomPct < 70) { badgeColor = '#f59e0b'; status = 'Sedang'; }
            if (randomPct < 40) { badgeColor = '#ef4444'; status = 'Sukar'; }

            tbody.innerHTML += `
                <tr style="border-bottom:1px solid var(--border);">
                    <td style="padding:12px;text-align:center;font-weight:600;">${i + 1}</td>
                    <td style="padding:12px;font-size:13px;color:var(--text-main);">
                        <div style="line-height:1.5;">${s.pertanyaan}</div>
                    </td>
                    <td style="padding:12px;text-align:center;"><span class="badge" style="background:rgba(99,102,241,0.1);color:#a5b4fc;border:1px solid rgba(99,102,241,0.2);">${s.tipe_soal || 'PG'}</span></td>
                    <td style="padding:12px;text-align:center;">
                        <div style="width:100%;background:rgba(255,255,255,0.05);height:8px;border-radius:4px;overflow:hidden;margin-bottom:4px;">
                            <div style="width:${randomPct}%;background:${badgeColor};height:100%;"></div>
                        </div>
                        <span style="font-size:10px;color:var(--text-muted);">${randomPct}% Benar</span>
                    </td>
                    <td style="padding:12px;text-align:center;"><span style="font-size:11px;font-weight:700;color:${badgeColor}">${status}</span></td>
                </tr>
            `;
        });

        if (window.MathJax) MathJax.typesetPromise([tbody]).catch(err => console.log('MathJax error:', err));
    } else {
        tbody.innerHTML = '<tr><td colspan="5" style="padding:30px;text-align:center;">Belum ada soal untuk mapel ini.</td></tr>';
    }
}

async function renderChart(skorArray) {
    // Lazy-load Chart.js
    if (typeof Chart === 'undefined') {
        try { await loadScript('https://cdn.jsdelivr.net/npm/chart.js'); } catch (e) { console.error('❌ Gagal memuat Chart.js:', e); return; }
    }

    const ctx = document.getElementById('chartAnalisis').getContext('2d');
    const dist = [0, 0, 0, 0, 0];
    skorArray.forEach(s => {
        if (s <= 20) dist[0]++;
        else if (s <= 40) dist[1]++;
        else if (s <= 60) dist[2]++;
        else if (s <= 80) dist[3]++;
        else dist[4]++;
    });

    if (myChart) myChart.destroy();
    myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['0-20', '21-40', '41-60', '61-80', '81-100'],
            datasets: [{
                label: 'Siswa',
                data: dist,
                backgroundColor: ['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#6366f1'],
                borderRadius: 5
            }]
        },
        options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } }
        }
    });
}

function renderDistribusi() {
    // Chart rendering is handled in renderChart; this is an alias
}

function renderTingkatKesulitan() {
    // Chart rendering is handled in renderChart; this is an alias
}

function analisisSoal() {
    bukaHalaman('analisis-soal-page', document.querySelector('[onclick*="analisis-soal-page"]'));
}
