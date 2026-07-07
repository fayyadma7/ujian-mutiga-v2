// @ts-nocheck
// ============================================================
// admin-ai.js — AI Soal Generator Module
// Supports: Gemini, Cerebras, Groq, Mistral (multi-provider)
// Features: KaTeX math rendering, RTL Arabic detection
// ============================================================

const PROVIDERS = [
  { name: 'gemini',   weight: 35 },
  { name: 'cerebras', weight: 25 },
  { name: 'groq',     weight: 20 },
  { name: 'mistral',  weight: 20 },
];

const AIGenerator = {
  modalEl: null,

  init() { if (!document.getElementById('ai-generator-modal')) this._buildModal(); },

  openModal() {
    this.init();
    this.modalEl.style.display = 'flex';
    const statusEl = document.getElementById('ai-status');
    if (statusEl) statusEl.innerHTML = '';
    const btn = document.getElementById('ai-generate-btn');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-robot"></i> Generate Soal'; }
  },
  closeModal() { if (this.modalEl) this.modalEl.style.display = 'none'; },

  // --- WEIGHTED RANDOM PROVIDER SELECTOR ---
  _selectProvider() {
    const roll = Math.random() * 100;
    let cum = 0;
    for (const p of PROVIDERS) {
      cum += p.weight;
      if (roll < cum) return p.name;
    }
    return 'gemini';
  },

  // --- CALL SINGLE AI PROVIDER ---
  async _callAI(provider, promptText) {
    const { data, error } = await db.functions.invoke('gemini-proxy', {
      body: { provider, promptText, temperature: 0.7 }
    });
    if (error) {
      let msg = error.message;
      try {
        const ctx = typeof error.context === 'string' ? JSON.parse(error.context) : error.context;
        msg = ctx?.error?.message || ctx?.message || msg;
      } catch {}
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error.message || 'AI error');
    if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) throw new Error('Empty AI response');
    return data;
  },

  // --- FALLBACK CHAIN ---
  async _generateWithFallback(promptText) {
    const primary = this._selectProvider();
    const ordered = [primary, ...PROVIDERS.map(p => p.name).filter(n => n !== primary)];

    let lastError = null;
    for (const provider of ordered) {
      try {
        const data = await this._callAI(provider, promptText);
        return { data, provider };
      } catch (e) {
        lastError = e;
        console.warn(`[AI] ${provider} gagal: ${e.message}`);
      }
    }
    throw new Error(`Semua AI provider gagal. Terakhir: ${lastError?.message}`);
  },

  // --- BUILD MODAL UI ---
  _buildModal() {
    const modal = document.createElement('div');
    modal.id = 'ai-generator-modal';
    modal.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(4,8,18,0.85);backdrop-filter:blur(12px);z-index:1050;justify-content:center;align-items:center;';
    modal.innerHTML = `
      <div style="background:rgba(12,19,38,0.97);border:1px solid rgba(255,255,255,0.08);padding:28px;border-radius:24px;width:90%;max-width:720px;max-height:90vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,0.5);border-top:4px solid var(--accent,#8b5cf6);color:var(--text-main,#e2e8f0);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;border-bottom:1px solid var(--border,#1e293b);padding-bottom:14px;">
          <h3 style="margin:0;font-size:1.2rem;font-weight:700;"><i class="fas fa-magic" style="color:var(--accent,#8b5cf6);"></i> AI Generator</h3>
          <button id="ai-modal-close" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--danger,#ef4444);opacity:0.8;">&times;</button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
          <div class="form-group">
            <label style="color:var(--text-subtle,#94a3b8);">Mata Pelajaran</label>
            <input type="text" id="ai-mapel" class="form-control" placeholder="Perbankan Syariah" required>
          </div>
          <div class="form-group">
            <label style="color:var(--text-subtle,#94a3b8);">Fase / Kelas</label>
            <select id="ai-fase" class="form-control">
              <option value="E/10">E / 10</option>
              <option value="F/11" selected>F / 11</option>
              <option value="F/12">F / 12</option>
            </select>
          </div>
        </div>

        <div class="form-group" style="margin-bottom:15px;">
          <label style="color:var(--text-subtle,#94a3b8);">Topik / Bab Materi</label>
          <input type="text" id="ai-topik" class="form-control" placeholder="Badan Usaha, Pendapatan Nasional" required>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px;margin-bottom:15px;">
          <div class="form-group">
            <label style="color:var(--text-subtle,#94a3b8);">Tingkat Kesulitan</label>
            <select id="ai-diff" class="form-control">
              <option value="LOTS">LOTS</option>
              <option value="MOTS" selected>MOTS</option>
              <option value="HOTS">HOTS</option>
            </select>
          </div>
          <div class="form-group">
            <label style="color:var(--text-subtle,#94a3b8);">Jumlah PG</label>
            <input type="number" id="ai-jml-pg" class="form-control" placeholder="5" min="0" max="30">
          </div>
          <div class="form-group">
            <label style="color:var(--text-subtle,#94a3b8);">Jumlah Essay</label>
            <input type="number" id="ai-jml-essay" class="form-control" placeholder="2" min="0" max="10">
          </div>
        </div>

        <div class="form-group" style="margin-bottom:15px;">
          <label style="color:var(--text-subtle,#94a3b8);">Referensi Materi / Teks Modul</label>
          <textarea id="ai-referensi" class="form-control" rows="5" placeholder="Tempel teks referensi atau modul di sini sebagai konteks AI..."></textarea>
        </div>

        <button id="ai-generate-btn" class="btn btn-purple" style="width:100%;justify-content:center;font-size:16px;">
          <i class="fas fa-robot"></i> Generate Soal
        </button>
        <div id="ai-status" style="margin-top:15px;font-weight:500;text-align:center;min-height:24px;"></div>
      </div>`;
    document.body.appendChild(modal);
    this.modalEl = modal;
    document.getElementById('ai-modal-close').onclick = () => this.closeModal();
    this.modalEl.addEventListener('click', (e) => { if (e.target === this.modalEl) this.closeModal(); });
    document.getElementById('ai-generate-btn').onclick = () => this.generateSoal();
  },

  // --- GENERATE SOAL ---
  async generateSoal() {
    const mapel = document.getElementById('ai-mapel').value.trim();
    const topik = document.getElementById('ai-topik').value.trim();
    const fase = document.getElementById('ai-fase').value;
    const diff = document.getElementById('ai-diff').value;
    const jmlPg = parseInt(document.getElementById('ai-jml-pg').value) || 0;
    const jmlEssay = parseInt(document.getElementById('ai-jml-essay').value) || 0;
    const referensi = document.getElementById('ai-referensi').value.trim();
    const statusEl = document.getElementById('ai-status');
    const btn = document.getElementById('ai-generate-btn');

    if (!mapel || !topik || (jmlPg === 0 && jmlEssay === 0)) {
      return showToast('Mapel, Topik, dan minimal 1 soal wajib diisi!', 'error');
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memproses...';
    statusEl.innerHTML = '<span style="color:var(--accent,#8b5cf6);"><i class="fas fa-spinner fa-spin"></i> Menghubungi AI...</span>';

    try {
      const conflictAction = await this._checkMapelConflict(mapel);
      if (conflictAction === 'cancel') { statusEl.innerHTML = ''; return; }

      statusEl.innerHTML = '<span style="color:var(--accent,#8b5cf6);"><i class="fas fa-spinner fa-spin"></i> AI sedang menulis soal...</span>';

      const promptText = this._buildPrompt({ mapel, topik, fase, diff, jmlPg, jmlEssay, referensi });

      const { data, provider } = await this._generateWithFallback(promptText);

      const soalArray = this._parseAIResponse(data, mapel);
      if (!soalArray || soalArray.length === 0) throw new Error('AI mengembalikan format yang tidak dikenali');

      const totalDiminta = jmlPg + jmlEssay;
      if (soalArray.length > totalDiminta) soalArray.length = totalDiminta;

      statusEl.innerHTML = '<span style="color:#10b981;"><i class="fas fa-spinner fa-spin"></i> Menyimpan ke database...</span>';

      const { error: insertError } = await chunkedInsert('bank_soal', soalArray);
      if (insertError) throw insertError;

      this.closeModal();

      const msg = soalArray.length < totalDiminta
        ? `AI (${provider}) hanya menghasilkan ${soalArray.length} dari ${totalDiminta} soal. Yang ada telah disimpan.`
        : `${soalArray.length} soal untuk ${mapel} berhasil dibuat oleh ${provider}.`;

      await Swal.fire({ icon: soalArray.length < totalDiminta ? 'info' : 'success', title: 'Generate Berhasil!', text: msg, confirmButtonColor: '#10b981' });

      await populatePreviewMapel();
      const optMapel = document.getElementById('preview-mapel');
      if (optMapel) {
        optMapel.value = mapel;
        document.getElementById('panel-daftar-mapel').style.display = 'none';
        document.getElementById('panel-detail-soal').style.display = 'block';
        document.getElementById('detail-mapel-title').innerText = 'Mata Pelajaran: ' + mapel;
        await loadPreviewSoal();
        this._renderMathInContainer(document.getElementById('panel-detail-soal'));
        this._applyRTL(document.getElementById('panel-detail-soal'));
      }
    } catch (err) {
      console.error('[AIGenerator]', err);
      statusEl.innerHTML = `<span style="color:var(--danger,#ef4444);"><i class="fas fa-exclamation-triangle"></i> ${err.message}</span>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-robot"></i> Generate Soal';
    }
  },

  // --- CHECK MAPEL CONFLICT ---
  async _checkMapelConflict(mapel) {
    const { count, error } = await db.from('bank_soal').select('*', { count: 'exact', head: true }).eq('mapel', mapel);
    if (error) return 'proceed';
    if (count > 0) {
      const result = await Swal.fire({
        title: 'Mapel Sudah Ada',
        html: `<b>${mapel}</b> sudah memiliki <b>${count}</b> soal.`,
        icon: 'question', showDenyButton: true,
        confirmButtonText: '<i class="fas fa-plus"></i> Tambahkan', confirmButtonColor: '#10b981',
        denyButtonText: '<i class="fas fa-trash-alt"></i> Timpa', denyButtonColor: '#ef4444',
        cancelButtonText: 'Batal'
      });
      if (result.isConfirmed) return 'append';
      if (result.isDenied) {
        const { data: oldIds } = await db.from('bank_soal').select('id').eq('mapel', mapel);
        if (oldIds?.length) {
          const { error: delErr } = await adminDb.batchDelete('bank_soal', oldIds.map(i => i.id));
          if (delErr) throw new Error('Gagal menghapus soal lama');
        }
        return 'overwrite';
      }
      return 'cancel';
    }
    return 'proceed';
  },

  // --- BUILD PROMPT ---
  _buildPrompt({ mapel, topik, fase, diff, jmlPg, jmlEssay, referensi }) {
    return `Anda adalah guru profesional di Indonesia. Buat soal ujian dengan spesifikasi berikut:

Mata Pelajaran: ${mapel}
Topik/Bab: ${topik}
Fase/Kelas: ${fase}
Tingkat Kesulitan: ${diff}

Target:
- ${jmlPg} soal Pilihan Ganda
- ${jmlEssay} soal Essay

${referensi ? `Referensi Materi (gunakan sebagai acuan utama):\n${referensi}\n` : ''}
Aturan format:
1. Gunakan <br> untuk baris baru, <b>/<i> untuk teks tebal/miring
2. Rumus matematika gunakan format $$...$$ (contoh: $$Q_d = a - bP$$, $$\\frac{1}{2}$$)
3. Tabel gunakan <table> HTML standar
4. JANGAN gunakan Markdown

Output HARUS JSON Array dengan struktur:
[
  {
    "mapel": "${mapel}",
    "pertanyaan": "...",
    "opsi_a": "... (kosong jika essay)",
    "opsi_b": "...",
    "opsi_c": "...",
    "opsi_d": "...",
    "opsi_e": "...",
    "kunci_jawaban": "A/B/C/D/E (kosong jika essay)",
    "tipe_soal": "PG atau ESSAY"
  }
]
Pastikan pengecoh sulit ditebak. Output WAJIB valid JSON mentah, tanpa markdown, tanpa teks tambahan.`;
  },

  // --- PARSE AI RESPONSE ---
  _parseAIResponse(data, mapel) {
    let jsonStr = data.candidates[0].content.parts[0].text;
    jsonStr = jsonStr.replace(/```json/gi, '').replace(/```/g, '').trim();

    // Bersihkan backslash bermasalah: ganti SEMUA \\ jadi \\\\ dulu, lalu parse
    // Ini lebih aman daripada regex exclusion list yang rusak untuk LaTeX
    let soalArray;
    try {
      soalArray = JSON.parse(jsonStr);
    } catch {
      // Fallback: escape semua backslash lalu coba parse lagi
      jsonStr = jsonStr.replace(/\\/g, '\\\\');
      soalArray = JSON.parse(jsonStr);
    }

    if (!Array.isArray(soalArray)) throw new Error('AI tidak mengembalikan array JSON');
    if (soalArray.length === 0) throw new Error('AI mengembalikan array kosong');

    // Post-processing helpers
    const stripOptions = (text, hasOpsi) => {
      if (!hasOpsi || !text) return text;
      return text
        .replace(/\n?\s*[A-E][\.\)]\s*.{0,200}/g, '')
        .replace(/\n{2,}/g, '\n')
        .trim();
    };
    const toSuperscript = (text) => text ? text.replace(/\^(\d+)/g, '<sup>$1</sup>') : '';
    const collapseNewlines = (text) => text ? text.replace(/\n{3,}/g, '<br><br>') : '';

    return soalArray.map(s => {
      let tipe = (s.tipe_soal || s.tipeSoal || s.tipe || 'PG').toString().toUpperCase().trim();
      let jawaban = (s.kunci_jawaban || s.kunci || s.jawaban || s.kunciJawaban || '').toString().toUpperCase().trim();
      if (tipe !== 'PG' && tipe !== 'ESSAY') tipe = jawaban ? 'PG' : 'ESSAY';
      if (tipe === 'PG' && jawaban.length > 1 && 'ABCDE'.includes(jawaban.charAt(0))) jawaban = jawaban.charAt(0);

      let pertanyaan = s.pertanyaan || '';
      const opsiA = s.opsi_a || s.opsiA || '';
      const opsiB = s.opsi_b || s.opsiB || '';
      const opsiC = s.opsi_c || s.opsiC || '';
      const opsiD = s.opsi_d || s.opsiD || '';
      const opsiE = s.opsi_e || s.opsiE || '';
      const hasOpsi = !!(opsiA || opsiB || opsiC || opsiD || opsiE);

      pertanyaan = stripOptions(pertanyaan, hasOpsi);
      pertanyaan = toSuperscript(pertanyaan);
      pertanyaan = collapseNewlines(pertanyaan);

      return {
        mapel: s.mapel || mapel,
        pertanyaan,
        opsi_a: toSuperscript(opsiA),
        opsi_b: toSuperscript(opsiB),
        opsi_c: toSuperscript(opsiC),
        opsi_d: toSuperscript(opsiD),
        opsi_e: toSuperscript(opsiE),
        kunci_jawaban: jawaban,
        tipe_soal: tipe,
      };
    });
  },

  // --- KATEX RENDER ---
  _renderMathInContainer(container) {
    if (typeof katex === 'undefined') return;
    // Render display math: $$...$$
    container.querySelectorAll('.teks-pertanyaan, .opsi-text, ul li div').forEach(el => {
      if (!el.dataset.mathRendered && el.textContent.includes('$$')) {
        el.innerHTML = el.innerHTML.replace(/\$\$([\s\S]+?)\$\$/g, (_, formula) => {
          try { return katex.renderToString(formula.trim(), { displayMode: true, throwOnError: false }); }
          catch { return `<code>$$${formula}$$</code>`; }
        });
        el.dataset.mathRendered = '1';
      }
    });
    // Render inline math: $...$  (hanya di teks pertanyaan)
    container.querySelectorAll('.teks-pertanyaan').forEach(el => {
      if (!el.dataset.inlineMathDone && el.textContent.includes('$')) {
        el.innerHTML = el.innerHTML.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, (_, formula) => {
          try { return katex.renderToString(formula.trim(), { displayMode: false, throwOnError: false }); }
          catch { return `<code>$${formula}$</code>`; }
        });
        el.dataset.inlineMathDone = '1';
      }
    });
  },

  // --- RTL DETECTION ---
  _applyRTL(container) {
    container.querySelectorAll('.teks-pertanyaan, .opsi-text, ul li div').forEach(el => {
      if (/[\u0600-\u06FF\u0750-\u077F]/.test(el.textContent)) {
        el.classList.add('rtl');
      }
    });
  },

  // --- GENERATE KISI-KISI ---
  async generateKisiKisi() {
    const mapel = document.getElementById('preview-mapel').value;
    if (!mapel) return showToast('Pilih mata pelajaran terlebih dahulu', 'error');

    const btn = document.getElementById('btn-kisi-kisi');
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menganalisis...';
    btn.disabled = true;

    try {
      const { data: soalData, error } = await db.from('bank_soal')
        .select('pertanyaan, kunci_jawaban, tipe_soal').eq('mapel', mapel);
      if (error || !soalData?.length) throw new Error('Tidak ada soal untuk dianalisis');

      const daftarSoal = soalData.map((s, i) => `Soal ${i+1}: ${s.pertanyaan.replace(/<[^>]+>/g, '')}`).join('\n');
      const promptText = `Buat kisi-kisi soal untuk mapel ${mapel} dalam format HTML table.\nDaftar soal:\n${daftarSoal}\n\nKisi-kisi harus tabel HTML dengan 2 kolom: "Materi Pokok" dan "Indikator Soal".\nKelompokkan soal serupa dalam 1 baris.\nOutput HANYA kode HTML tabel, tanpa markdown.`;

      const { data } = await this._generateWithFallback(promptText);

      let html = data.candidates[0].content.parts[0].text;
      html = html.replace(/```html/gi, '').replace(/```/g, '').trim();

      await Swal.fire({
        title: `Kisi-kisi: ${mapel}`,
        html: `<div style="text-align:left;font-size:14px;max-height:60vh;overflow-y:auto;padding:10px;"><h2 style="text-align:center;font-size:18px;margin-bottom:15px;color:#e2e8f0;">KISI-KISI SOAL - ${mapel.toUpperCase()}</h2>${html}</div>`,
        width: 800, background: 'rgba(15,23,42,0.95)', color: '#e2e8f0',
        showCancelButton: true, confirmButtonText: '<i class="fas fa-copy"></i> Copy', confirmButtonColor: '#059669', cancelButtonText: 'Tutup'
      }).then((result) => {
        if (result.isConfirmed) navigator.clipboard?.writeText(html).then(() => showToast('Kisi-kisi disalin!', 'success'));
      });
    } catch (err) {
      console.error('[AIGenerator:kisi]', err);
      Swal.fire('Gagal', err.message, 'error');
    } finally {
      btn.innerHTML = orig;
      btn.disabled = false;
    }
  },
};

// Global compatibility bridge for old handleMapelConflict calls from admin-soal.js
window.handleMapelConflict = async function handleMapelConflict(mapel, statusEl) {
  const action = await AIGenerator._checkMapelConflict(mapel);
  if (action === 'cancel') return 'cancel';
  if (action === 'overwrite') {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--accent);"><i class="fas fa-trash-alt"></i> Soal lama dihapus, menambahkan yang baru...</span>`;
  }
  return action || 'proceed';
};

AIGenerator.init();
