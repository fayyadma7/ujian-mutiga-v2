// @ts-nocheck
// ============================================================
// admin-ai.js — AI Soal Generator Module
// Supports: Gemini, Cerebras, Groq, Mistral (multi-provider)
// Features: KaTeX math rendering, RTL Arabic detection
// + Lampiran Referensi Word/PDF (single file, 10MB, mutually exclusive with textarea)
// ============================================================

const PROVIDERS = [
  { name: 'gemini',   weight: 35 },
  { name: 'cerebras', weight: 25 },
  { name: 'groq',     weight: 20 },
  { name: 'mistral',  weight: 20 },
];

const AIGenerator = {
  modalEl: null,
  _attachedText: "",
  _attachedFileName: "",
  _isFileActive: false,
  _pdfJsLoading: null,

  init() { if (!document.getElementById('ai-generator-modal')) this._buildModal(); },

  openModal() {
    this.init();
    this.modalEl.style.display = 'flex';
    const statusEl = document.getElementById('ai-status');
    if (statusEl) statusEl.innerHTML = '';
    const btn = document.getElementById('ai-generate-btn');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-robot"></i> Generate Soal'; }
  },
  closeModal() {
    if (this.modalEl) this.modalEl.style.display = 'none';
    // reset lampiran on close to keep modal fresh (optional but prevents stale lock)
    // keep data until next open? we clear to avoid confusion
    this._clearAttachment(true);
  },

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

  // ============================================================
  // LAMPIRAN REFERENSI — WORD / PDF
  // ============================================================
  _setReferensiDisabled(locked) {
    const ta = document.getElementById('ai-referensi');
    const label = document.getElementById('ai-referensi-label');
    if (!ta) return;
    ta.disabled = locked;
    if (locked) {
      ta.style.opacity = '0.45';
      ta.style.pointerEvents = 'none';
      ta.style.background = 'rgba(255,255,255,0.04)';
      ta.placeholder = 'Nonaktif — hapus lampiran untuk input manual...';
      if (label) label.innerHTML = '<i class="fas fa-lock" style="color:#f59e0b;"></i> Referensi Materi / Teks Modul <span style="font-size:10px;font-weight:600;color:#f59e0b;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.25);padding:2px 7px;border-radius:999px;margin-left:6px;"><i class="fas fa-paperclip"></i> Terkunci oleh lampiran</span>';
    } else {
      ta.style.opacity = '';
      ta.style.pointerEvents = '';
      ta.style.background = '';
      ta.placeholder = 'Tempel teks referensi atau modul di sini sebagai konteks AI...';
      if (label) label.innerHTML = 'Referensi Materi / Teks Modul';
    }
  },

  _formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1048576).toFixed(2) + ' MB';
  },

  _truncateReferensi(text, max = 15000) {
    if (!text) return { text: '', truncated: false };
    if (text.length <= max) return { text, truncated: false };
    return { text: text.slice(0, max) + '\n\n[...teks dipangkas ke ' + max.toLocaleString('id-ID') + ' karakter karena terlalu panjang — sisa diabaikan...]', truncated: true };
  },

  _getEffectiveReferensi() {
    if (this._isFileActive && this._attachedText) return this._attachedText;
    const ta = document.getElementById('ai-referensi');
    return ta ? ta.value.trim() : '';
  },

  async _loadMammoth() {
    if (typeof mammoth !== 'undefined') return;
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.4.21/mammoth.browser.min.js');
    if (typeof mammoth === 'undefined') throw new Error('Gagal memuat mammoth');
  },

  async _loadPdfJs() {
    if (typeof window.pdfjsLib !== 'undefined') return;
    if (this._pdfJsLoading) return this._pdfJsLoading;
    this._pdfJsLoading = (async () => {
      // pdf.js legacy build (non-module) yang expose window.pdfjsLib
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      if (typeof window.pdfjsLib === 'undefined' && typeof window.pdfjsLib === 'undefined') {
        // fallback CDN
        await loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js');
      }
      if (typeof window.pdfjsLib === 'undefined') throw new Error('Gagal memuat pdf.js');
      // set worker
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      } catch {}
    })();
    return this._pdfJsLoading;
  },

  async _extractTextFromDocx(arrayBuffer) {
    await this._loadMammoth();
    // prefer extractRawText (clean text) untuk AI
    const result = await mammoth.extractRawText({ arrayBuffer });
    let text = (result.value || '').trim();
    // fallback: if raw empty but HTML has content, try HTML then strip
    if (!text) {
      const htmlRes = await mammoth.convertToHtml({ arrayBuffer });
      const tmp = document.createElement('div');
      tmp.innerHTML = htmlRes.value || '';
      text = (tmp.textContent || tmp.innerText || '').trim();
    }
    return text.replace(/\r/g, '').replace(/\u00A0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  },

  async _extractTextFromPdf(arrayBuffer) {
    await this._loadPdfJs();
    const pdfjsLib = window.pdfjsLib;
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';
    const totalPages = pdf.numPages;
    const statusEl = document.getElementById('ai-file-extract-status');
    for (let i = 1; i <= totalPages; i++) {
      if (statusEl) statusEl.textContent = `Mengekstrak halaman ${i}/${totalPages}...`;
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(it => it.str).join(' ');
      fullText += pageText + '\n\n';
      // yield to UI every 10 pages for large PDFs
      if (i % 10 === 0) await new Promise(r => setTimeout(r, 0));
    }
    return fullText.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  },

  _updateFileUIAfterExtract(file, charCount, truncated) {
    const dropEl = document.getElementById('ai-file-drop');
    const statusBox = document.getElementById('ai-file-status');
    const previewBox = document.getElementById('ai-file-preview');
    const ta = document.getElementById('ai-referensi');
    if (dropEl) dropEl.style.display = 'none';
    if (statusBox) {
      statusBox.style.display = 'flex';
      const truncatedBadge = truncated ? '<span style="font-size:10px;background:rgba(245,158,11,0.15);color:#fbbf24;border:1px solid rgba(245,158,11,0.25);padding:2px 6px;border-radius:999px;margin-left:6px;">dipangkas 15k</span>' : '';
      statusBox.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
          <div style="width:38px;height:38px;border-radius:10px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.2);display:flex;align-items:center;justify-content:center;color:#34d399;flex-shrink:0;"><i class="fas ${file.name.toLowerCase().endsWith('.pdf') ? 'fa-file-pdf' : 'fa-file-word'}"></i></div>
          <div style="min-width:0;flex:1;">
            <div style="font-size:13px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${file.name}</div>
            <div style="font-size:11px;color:#94a3b8;">${this._formatBytes(file.size)} · ${charCount.toLocaleString('id-ID')} karakter ${truncatedBadge}</div>
          </div>
        </div>
        <button type="button" id="ai-file-remove-btn" style="flex-shrink:0;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:#f87171;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;"><i class="fas fa-trash-alt"></i> Hapus</button>
      `;
      const btnRemove = document.getElementById('ai-file-remove-btn');
      if (btnRemove) btnRemove.onclick = () => this._clearAttachment(false);
    }
    if (previewBox) {
      const snippet = this._attachedText.slice(0, 700);
      const more = this._attachedText.length > 700 ? '...' : '';
      previewBox.style.display = 'block';
      previewBox.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:0.3px;text-transform:uppercase;"><i class="fas fa-eye" style="margin-right:4px;"></i> Preview Ekstrak</span>
          <span style="font-size:11px;color:#64748b;">${this._attachedText.length > 700 ? '700/' + this._attachedText.length.toLocaleString('id-ID') : charCount.toLocaleString('id-ID') + ' char'}</span>
        </div>
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px 12px;font-size:12px;line-height:1.6;color:#cbd5e1;max-height:120px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;">${this._escapeHtml(snippet + more) || '<span style="color:#64748b;font-style:italic;">(tidak ada teks terekstrak)</span>'}</div>
        ${this._attachedText.length > 700 ? '<div style="font-size:11px;color:#64748b;margin-top:6px;text-align:center;">Teks lengkap ('+this._attachedText.length.toLocaleString('id-ID')+' karakter) akan dikirim ke AI</div>' : ''}
      `;
    }
    this._setReferensiDisabled(true);
  },

  _escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  },

  _clearAttachment(silent = false) {
    this._attachedText = "";
    this._attachedFileName = "";
    this._isFileActive = false;
    const input = document.getElementById('ai-referensi-file');
    if (input) input.value = '';
    const dropEl = document.getElementById('ai-file-drop');
    const statusBox = document.getElementById('ai-file-status');
    const previewBox = document.getElementById('ai-file-preview');
    const extractStatus = document.getElementById('ai-file-extract-status');
    if (dropEl) dropEl.style.display = 'flex';
    if (statusBox) { statusBox.style.display = 'none'; statusBox.innerHTML = ''; }
    if (previewBox) { previewBox.style.display = 'none'; previewBox.innerHTML = ''; }
    if (extractStatus) extractStatus.textContent = '';
    this._setReferensiDisabled(false);
    if (!silent) {
      const ta = document.getElementById('ai-referensi');
      if (ta) ta.focus();
    }
  },

  async _handleAttachmentChange(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const MAX_BYTES = 10 * 1024 * 1024;
    const statusBox = document.getElementById('ai-file-status');
    const previewBox = document.getElementById('ai-file-preview');
    const extractStatus = document.getElementById('ai-file-extract-status');
    const dropEl = document.getElementById('ai-file-drop');

    // validations
    if (file.size > MAX_BYTES) {
      showToast('File terlalu besar! Maksimal 10 MB. File Anda: ' + this._formatBytes(file.size), 'error');
      input.value = '';
      return;
    }
    const ext = file.name.toLowerCase().split('.').pop();
    if (!['pdf','docx'].includes(ext)) {
      showToast('Format tidak didukung. Gunakan .docx atau .pdf', 'error');
      input.value = '';
      return;
    }
    // if already has file, replace silently (no confirm needed — single file policy)
    if (this._isFileActive) {
      // quick visual feedback that replacing
      if (extractStatus) extractStatus.textContent = 'Mengganti lampiran...';
    }

    // show extracting state
    if (dropEl) dropEl.style.opacity = '0.6';
    if (dropEl) dropEl.style.pointerEvents = 'none';
    if (statusBox) { statusBox.style.display = 'none'; }
    if (previewBox) { previewBox.style.display = 'none'; }
    if (extractStatus) {
      extractStatus.style.display = 'block';
      extractStatus.innerHTML = '<span style="color:#8b5cf6;"><i class="fas fa-spinner fa-spin"></i> Mengekstrak teks dari ' + this._escapeHtml(file.name) + '...</span>';
    }

    try {
      const ab = await file.arrayBuffer();
      let rawText = '';
      if (ext === 'docx') {
        rawText = await this._extractTextFromDocx(ab);
      } else {
        rawText = await this._extractTextFromPdf(ab);
      }

      if (!rawText || rawText.trim().length < 10) {
        // PDF scan / empty
        if (extractStatus) extractStatus.innerHTML = '<span style="color:#f59e0b;"><i class="fas fa-exclamation-triangle"></i> File tidak mengandung teks yang bisa dibaca. PDF mungkin hasil scan/gambar. Hapus lampiran untuk pakai input manual.</span>';
        // still lock textarea but show empty state, user must delete to unlock
        const truncatedRes = this._truncateReferensi('', 15000);
        this._attachedText = truncatedRes.text;
        this._attachedFileName = file.name;
        this._isFileActive = true;
        this._updateFileUIAfterExtract(file, 0, false);
        // override preview to warn
        if (previewBox) {
          previewBox.innerHTML = '<div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:10px;padding:10px 12px;font-size:12px;color:#fbbf24;"><i class="fas fa-exclamation-circle"></i> Tidak ada teks terekstrak. Jika ini PDF scan, ubah ke PDF text-based atau ketik manual setelah menghapus lampiran.</div>';
          previewBox.style.display = 'block';
        }
        showToast('Lampiran tidak mengandung teks. Gunakan PDF text-based atau .docx', 'error');
        return;
      }

      const trunc = this._truncateReferensi(rawText, 15000);
      this._attachedText = trunc.text;
      this._attachedFileName = file.name;
      this._isFileActive = true;
      if (extractStatus) extractStatus.style.display = 'none';
      this._updateFileUIAfterExtract(file, rawText.length, trunc.truncated);
      if (trunc.truncated) {
        showToast('Teks lampiran dipangkas ke 15.000 karakter agar muat di AI (' + rawText.length.toLocaleString('id-ID') + ' → 15.000)', 'info');
      } else {
        showToast('Lampiran berhasil dibaca (' + rawText.length.toLocaleString('id-ID') + ' karakter)', 'success');
      }
    } catch (err) {
      console.error('[AI attachment]', err);
      if (extractStatus) extractStatus.innerHTML = '<span style="color:#ef4444;"><i class="fas fa-times-circle"></i> Gagal mengekstrak: ' + this._escapeHtml(err.message) + '</span>';
      showToast('Gagal membaca file: ' + err.message, 'error');
      input.value = '';
      this._clearAttachment(true);
      // re-enable drop
      if (dropEl) { dropEl.style.opacity = ''; dropEl.style.pointerEvents = ''; }
      return;
    } finally {
      if (dropEl) { dropEl.style.opacity = ''; dropEl.style.pointerEvents = ''; }
      if (extractStatus && this._isFileActive) extractStatus.style.display = 'none';
    }
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

        <div class="form-group" style="margin-bottom:10px;">
          <label id="ai-referensi-label" style="color:var(--text-subtle,#94a3b8);">Referensi Materi / Teks Modul</label>
          <textarea id="ai-referensi" class="form-control" rows="5" placeholder="Tempel teks referensi atau modul di sini sebagai konteks AI..."></textarea>
          <div style="font-size:11px;color:#64748b;margin-top:4px;display:flex;align-items:center;gap:6px;"><i class="fas fa-info-circle"></i> Isi manual <b>atau</b> upload 1 file di bawah — tidak bisa bersamaan.</div>
        </div>

        <!-- Upload Lampiran Referensi (Word/PDF) — Single File 10MB -->
        <div style="margin-bottom:15px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px;">
            <label style="margin:0;color:var(--text-subtle,#94a3b8);font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;"><i class="fas fa-paperclip" style="color:var(--accent,#8b5cf6);"></i> Lampiran Referensi <span style="font-weight:400;font-size:11px;color:#64748b;">(opsional)</span></label>
            <span style="font-size:10px;font-weight:600;color:#94a3b8;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);padding:3px 8px;border-radius:999px;letter-spacing:0.3px;"><i class="fas fa-file-alt"></i> 1 file · max 10MB · .docx / .pdf</span>
          </div>

          <div id="ai-file-drop" style="border:1.5px dashed rgba(139,92,246,0.35);background:rgba(139,92,246,0.06);border-radius:12px;padding:16px;text-align:center;cursor:pointer;transition:all 0.2s;display:flex;flex-direction:column;align-items:center;gap:6px;">
            <div style="width:40px;height:40px;border-radius:10px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.25);display:flex;align-items:center;justify-content:center;color:#a78bfa;font-size:18px;"><i class="fas fa-cloud-upload-alt"></i></div>
            <div style="font-size:13px;font-weight:600;color:#e2e8f0;">Klik atau seret file ke sini</div>
            <div style="font-size:11px;color:#94a3b8;">Word (.docx) atau PDF text-based</div>
            <div style="font-size:11px;color:#64748b;font-style:italic;">Jika lampiran diisi, kolom teks manual akan terkunci otomatis</div>
            <input type="file" id="ai-referensi-file" accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="display:none;">
          </div>

          <div id="ai-file-extract-status" style="display:none;margin-top:10px;font-size:12px;text-align:center;min-height:18px;"></div>
          <div id="ai-file-status" style="display:none;margin-top:10px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.12);border-radius:12px;padding:10px 12px;align-items:center;justify-content:space-between;gap:10px;"></div>
          <div id="ai-file-preview" style="display:none;margin-top:10px;"></div>
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

    // --- Lampiran file handlers ---
    const fileInput = document.getElementById('ai-referensi-file');
    const dropEl = document.getElementById('ai-file-drop');
    if (fileInput && dropEl) {
      dropEl.onclick = () => fileInput.click();
      fileInput.onchange = () => this._handleAttachmentChange(fileInput);
      // drag & drop
      dropEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropEl.style.borderColor = 'rgba(139,92,246,0.65)';
        dropEl.style.background = 'rgba(139,92,246,0.12)';
      });
      dropEl.addEventListener('dragleave', () => {
        dropEl.style.borderColor = 'rgba(139,92,246,0.35)';
        dropEl.style.background = 'rgba(139,92,246,0.06)';
      });
      dropEl.addEventListener('drop', (e) => {
        e.preventDefault();
        dropEl.style.borderColor = 'rgba(139,92,246,0.35)';
        dropEl.style.background = 'rgba(139,92,246,0.06)';
        const files = e.dataTransfer.files;
        if (files && files[0]) {
          // validate via DataTransfer
          const dt = new DataTransfer();
          dt.items.add(files[0]);
          fileInput.files = dt.files;
          this._handleAttachmentChange(fileInput);
        }
      });
    }
  },

  // --- GENERATE SOAL ---
  async generateSoal() {
    const mapel = document.getElementById('ai-mapel').value.trim();
    const topik = document.getElementById('ai-topik').value.trim();
    const fase = document.getElementById('ai-fase').value;
    const diff = document.getElementById('ai-diff').value;
    const jmlPg = parseInt(document.getElementById('ai-jml-pg').value) || 0;
    const jmlEssay = parseInt(document.getElementById('ai-jml-essay').value) || 0;
    const referensi = this._getEffectiveReferensi();
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

  _buildPrompt({ mapel, topik, fase, diff, jmlPg, jmlEssay, referensi }) {
    return `Kamu adalah AI EXPERT ASSESSMENT GENERATOR, yaitu seorang ahli profesional dalam penyusunan instrumen evaluasi dan asesmen pendidikan.

Tugas utama kamu adalah menghasilkan soal yang berkualitas tinggi, relevan, akurat secara akademik, sesuai dengan tingkat pendidikan peserta didik, serta dapat digunakan langsung oleh guru untuk kegiatan penilaian.

Kamu harus menghasilkan soal berdasarkan parameter yang diberikan oleh pengguna.

==================================================
PARAMETER INPUT
==================================================

Gunakan seluruh informasi yang diberikan pengguna sebagai parameter utama dalam menghasilkan soal:

1. MATA PELAJARAN: ${mapel}
2. FASE / KELAS: ${fase}
3. TOPIK / BAB MATERI: ${topik}
4. TINGKAT KESULITAN: ${diff}
5. JUMLAH SOAL PILIHAN GANDA: ${jmlPg}
6. JUMLAH SOAL ESSAY: ${jmlEssay}
${referensi ? `7. REFERENSI MATERI / TEKS MODUL:\n${referensi}\n` : ''}

Semua soal yang dibuat HARUS mengikuti parameter tersebut.
Jika ada Referensi Materi, gunakan referensi tersebut sebagai sumber utama — TAPI JANGAN PERNAH MENYEBUT KEBERADAANNYA DI DALAM SOAL (lihat Aturan Mutlak di bawah).

==================================================
0. ATURAN MUTLAK: TIDAK BOLEH ADA "JEJAK" REFERENSI DI DALAM SOAL — PRIORITAS #1 TIDAK BOLEH DILANGGAR
==================================================
Ini aturan PALING PENTING dan mengalahkan semua instruksi lain dalam kondisi apa pun.

Prinsip dasar:
- referensi_materi adalah bahan bacaanmu, BUKAN bahan yang boleh kamu tunjuk-tunjuk di dalam soal.
- Perlakukan referensi itu seperti kamu sedang belajar dari buku, lalu MENUTUP buku itu, dan menulis soal dari pemahamanmu sendiri — persis seperti penulis bank soal profesional bekerja.
- Hasilnya HARUS terbaca alami dan berdiri sendiri (self-contained), seolah soal itu memang sudah ada di buku cetak / bank soal resmi, bukan soal yang "dibuat dari suatu teks".

FRASA YANG DILARANG KERAS (dan semua variasinya) — JANGAN PERNAH memunculkan pola kalimat seperti ini di badan soal, opsi jawaban, maupun essay:
- "Berdasarkan referensi materi..." / "Berdasarkan referensi..."
- "Berdasarkan teks di atas..." / "Berdasarkan modul/artikel di atas..."
- "Menurut referensi/teks/modul yang diberikan..."
- "Sesuai dengan materi yang disediakan..." / "Merujuk pada teks referensi..."
- "Dari bacaan di atas..." / "Sebagaimana dijelaskan dalam referensi..."
- Kata kunci apa pun yang mengarah ke "referensi", "teks di atas", "modul ini", "bacaan tersebut", "artikel yang diberikan", dsb.

CARA MEMPERBAIKI (WAJIB DIIKUTI):
- Ekstrak fakta, konsep, istilah, angka, dan konteks konkret dari referensi_materi (misalnya nama lembaga, definisi, data, studi kasus), lalu tuliskan ulang menjadi soal yang berdiri sendiri.
- Ganti kalimat penunjuk referensi dengan subjek konkret dari materi itu sendiri.
- Jika referensi_materi kosong, buat soal langsung dari pengetahuan umum sesuai mata_pelajaran dan topik_bab_materi, tanpa menyebut "referensi" sama sekali.

Contoh SALAH vs BENAR:
❌ SALAH: "Berdasarkan referensi materi, Bank Muamalat adalah..."
✅ BENAR: "Bank yang tercatat sebagai bank syariah pertama di Indonesia dan berdiri pada tahun 1991 adalah..."

❌ SALAH: "Menurut teks di atas, apa yang dimaksud dengan pendapatan nasional?"
✅ BENAR: "Total nilai barang dan jasa akhir yang dihasilkan oleh suatu negara dalam satu periode tertentu disebut..."

VALIDASI FINAL SEBELUM OUTPUT:
Periksa ulang SETIAP soal — jika soal tidak bisa dipahami tanpa mengetahui bahwa ada "referensi" yang diberikan ke AI, soal itu GAGAL dan HARUS ditulis ulang sampai self-contained. Semua soal harus lolos tes ini.

==================================================
PRINSIP UTAMA
==================================================
Prioritas utama dalam pembuatan soal adalah:
1. Kesesuaian dengan materi, fase/kelas, dan tingkat kesulitan.
2. Ketepatan konsep dan jawaban.
3. Kejelasan bahasa.
4. Keunikan setiap soal.
5. Variasi bentuk pertanyaan.
6. Kualitas pilihan jawaban.
7. Distribusi jawaban benar yang bervariasi.
8. Tidak adanya pola jawaban yang mudah ditebak.
9. Tidak adanya soal yang sama atau terlalu mirip.
10. Soal harus terasa seperti dibuat oleh penyusun asesmen profesional.

==================================================
1. KESESUAIAN MATERI & TINGKAT KESULITAN
==================================================
Setiap soal harus sesuai dengan Mata Pelajaran, Fase, Topik, dan Referensi.

Tingkat kesulitan soal HARUS mengikuti pengaturan yang dipilih pengguna (${diff}):

LOTS (Lower Order Thinking Skills):
Mengingat, Mengenali, Menjelaskan konsep dasar, Menerapkan konsep sederhana.

MOTS (Middle Order Thinking Skills):
Menghubungkan konsep, Membandingkan, Menentukan hubungan sebab akibat, Menerapkan konsep dalam situasi kontekstual, Menganalisis masalah sederhana.

HOTS (Higher Order Thinking Skills):
Menganalisis informasi kompleks, Mengevaluasi, Menentukan solusi terbaik, Menarik kesimpulan berdasarkan data, Memberikan argumentasi.

ATURAN PENTING:
- Jangan membuat soal LOTS terlalu sulit.
- Jangan membuat soal HOTS hanya berupa pertanyaan definisi.
- Jangan membuat semua soal memiliki pola berpikir yang sama.

==================================================
2. KEUNIKAN DAN ANTI-DUPLIKASI SOAL
==================================================
Setiap soal HARUS unik. DILARANG menghasilkan:
- Soal yang sama persis.
- Soal yang hanya mengganti nama/angka/kata.
- Soal yang memiliki stimulus dan pola penyelesaian yang sama.

Gunakan variasi substantif melalui: Konteks berbeda, Kasus berbeda, Sudut pandang berbeda, Kata kerja operasional berbeda.

==================================================
3. KUALITAS SOAL & OPSI PILIHAN GANDA
==================================================
- Semua opsi (A, B, C, D, E) harus relevan, panjangnya seimbang, dan struktur bahasanya konsisten.
- Distraktor harus masuk akal dan mencerminkan kemungkinan miskonsepsi siswa. Jangan buat jawaban yang terlalu jelas salah.
- Hindari penggunaan: Semua jawaban benar, Semua jawaban salah.
- Distribusikan posisi jawaban benar secara bervariasi dan alami (JANGAN menumpuk di 1 atau 2 huruf saja).
- Kelima opsi memiliki peluang yang setara.
- PENTING: Jika pengguna meminta soal Bahasa Arab, Bahasa Jawa (Aksara Jawa), atau materi yang memerlukan skrip khusus, gunakan karakter unicode asli (contoh: huruf Arab lengkap dengan harakat, atau Aksara Jawa asli) di teks soal dan opsi.
- PENTING UNTUK KIMIA: Jika soal Kimia, gunakan langsung karakter unicode asli untuk rumus kimia, subscript, superscript, dan panah reaksi (contoh: H₂O, SO₄²⁻, →, ⇌). JANGAN menggunakan package eksternal seperti mhchem (\\ce{}). Rumus matematika/perhitungan tetap gunakan LaTeX standar dengan $...$.

==================================================
4. KUALITAS SOAL ESSAY
==================================================
- Memiliki tujuan penilaian jelas.
- Mendorong siswa memberikan jawaban berdasarkan pemahaman.
- Hindari pertanyaan terlalu umum seperti "Jelaskan materi tersebut!".
- Gunakan kata kerja operasional yang sesuai tingkat kesulitan (LOTS: Sebutkan/Jelaskan. MOTS: Bandingkan/Terapkan. HOTS: Evaluasi/Analisis).

==================================================
ATURAN FORMAT PENULISAN & RUMUS (WAJIB DIIKUTI)
==================================================
1. Gunakan <br> untuk baris baru, <b>/<i> untuk teks tebal/miring.
2. Rumus matematika inline gunakan $...$ (contoh: $f(x) = 2\\sin x$, $\\sqrt{7}$, $\\frac{1}{2}$).
3. Rumus matematika display gunakan $$...$$ (contoh: $$\\int_0^1 x^2 dx$$).
4. SEMUA LaTeX command WAJIB dibungkus $...$ atau $$...$$. JANGAN pernah output LaTeX mentah.
5. JANGAN bungkus angka sederhana/uang. Contoh BENAR: Rp 10.000.
6. Tabel gunakan <table> HTML standar.

==================================================
FORMAT OUTPUT (PENTING: HARUS JSON!!!)
==================================================
Sistem backend ini HANYA MENERIMA OUTPUT BERUPA JSON ARRAY. PENGABAIAN ATURAN INI AKAN MENYEBABKAN ERROR PADA APLIKASI.
JANGAN gunakan format teks biasa / markdown / format dokumen! KEMBALIKAN OUTPUT **HANYA** SEBAGAI VALID JSON ARRAY MENTAH TANPA TEKS TAMBAHAN.

Struktur JSON yang WAJIB digunakan:
[
  {
    "mapel": "${mapel}",
    "pertanyaan": "Isi pertanyaan (termasuk stimulus/kasus/tabel jika ada)...",
    "opsi_a": "Teks opsi A (kosong jika tipe_soal ESSAY)",
    "opsi_b": "Teks opsi B (kosong jika tipe_soal ESSAY)",
    "opsi_c": "Teks opsi C (kosong jika tipe_soal ESSAY)",
    "opsi_d": "Teks opsi D (kosong jika tipe_soal ESSAY)",
    "opsi_e": "Teks opsi E (kosong jika tipe_soal ESSAY)",
    "kunci_jawaban": "A/B/C/D/E (untuk soal essay: tulis pedoman jawabannya secara ringkas di sini)",
    "tipe_soal": "PG atau ESSAY"
  }
]

PRIORITAS UTAMA:
KUALITAS > KESESUAIAN > KEUNIKAN > VARIASI > JUMLAH
Selalu pastikan JSON valid dan format opsi tidak bocor ke markdown luar.

PENGINGAT FINAL — ANTI JEJAK REFERENSI (CEK ULANG WAJIB):
Sebelum menutup JSON, lakukan self-check: TIDAK ADA SATU PUN soal/opsi/kunci yang mengandung kata "referensi", "teks di atas", "modul ini/di atas", "bacaan tersebut/di atas", "artikel yang diberikan" atau frasa penunjuk referensi apa pun. Jika ada, HAPUS dan tulis ulang menjadi soal self-contained dengan subjek konkret dari materi. Pelanggaran = soal GAGAL. Semua soal harus lolos tes self-contained (bisa dipahami tanpa tahu ada referensi).`;
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
    const collapseNewlines = (text) => text ? text.replace(/\n{3,}/g, '<br><br>') : '';
    const smartTrim = (text) => text ? text.replace(/^[\s\n]+|[\s\n]+$/g, '').replace(/\n{3,}/g, '<br><br>') : '';
    // Anti-jejak referensi: hapus sisa frasa terlarang jika AI masih membandel (defensive sanitizer)
    const cleanReferenceTraces = (text) => {
      if (!text) return text;
      let t = text;
      // Hapus pola terlarang di awal kalimat (paling umum)
      t = t.replace(/^\s*(Berdasarkan|Menurut|Sesuai dengan|Merujuk pada|Sebagaimana dijelaskan dalam)\s+[^.!?]*?(referensi|teks di atas|teks tersebut|modul|bacaan di atas|bacaan tersebut|materi yang disediakan|artikel yang diberikan)[^.!?]*?[,:]\s*/gi, '');
      t = t.replace(/^\s*(Berdasarkan|Menurut)\s+(referensi|teks|modul|artikel)[^.!?]*?[,:]\s*/gi, '');
      t = t.replace(/^\s*Dari\s+bacaan\s+di\s+atas\s*[,:]?\s*/gi, '');
      // Hapus di tengah kalimat (inline)
      t = t.replace(/\s*\(?\s*berdasarkan\s+referensi[^)]*\)?/gi, '');
      t = t.replace(/\s*\(?\s*menurut\s+teks\s+di\s+atas[^)]*\)?/gi, '');
      t = t.replace(/\s*\(?\s*sesuai\s+dengan\s+materi[^)]*\)?/gi, '');
      t = t.replace(/\s{2,}/g, ' ').trim();
      // Kapitalisasi awal jika terpotong
      if (t) t = t.charAt(0).toUpperCase() + t.slice(1);
      return t;
    };
    // Normalisasi rumus: angka sederhana → unwrap, formula pendek → inline $...$, formula panjang → display $$...$$
    const normalizeMath = (text, forceInline) => {
      if (!text) return text;
      return text.replace(/\$\$([\s\S]+?)\$\$/g, (match, inner) => {
        const trimmed = inner.trim();
        // 1. Angka sederhana → unwrap langsung
        if (/^[\d.,\s Rp\$%\-()+]*$/.test(trimmed) && !/[a-zA-Z]/.test(trimmed.replace(/Rp/gi, ''))) {
          return trimmed;
        }
        // 2. Force inline (opsi jawaban) → $...$
        if (forceInline) {
          return '$' + trimmed + '$';
        }
        // 3. Formula pendek (< 60 char) dan tanpa \\ (linebreak) → inline $...$
        if (trimmed.length < 60 && !/\\\\/.test(trimmed) && !/\n/.test(trimmed)) {
          return '$' + trimmed + '$';
        }
        // 4. Formula panjang/complex → tetap $$...$$ (display)
        return match;
      });
    };
    // Deteksi LaTeX mentah yang tidak terbungkus $...$ lalu bungkus otomatis
    const wrapBareLatex = (text) => {
      if (!text) return text;
      // Decode HTML entities yang mungkin muncul dari AI
      let t = text
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/&le;/g, '\\le').replace(/&ge;/g, '\\ge');
      // Pola LaTeX: \command, ^{...}, _{...}, ^\circ, dll
      const hasLatex = /\\[a-zA-Z]+|[\\^]_\{|\\frac|\\sqrt|\\sin|\\cos|\\tan|\\le|\\ge|\\leq|\\geq|\\times|\\div|\\pi|\\theta|\\alpha|\\beta|\\gamma|\\circ|\^[\\{a-zA-Z]|_[\\{a-zA-Z]/.test(t);
      if (!hasLatex) return text;
      // Pisah menjadi segmen: di dalam $...$ atau $$...$$ vs di luar
      const segments = [];
      let pos = 0;
      const mathRe = /\$\$[\s\S]+?\$\$|\$[^$]+?\$/g;
      let m;
      while ((m = mathRe.exec(t)) !== null) {
        if (m.index > pos) segments.push({ text: t.slice(pos, m.index), isMath: false });
        segments.push({ text: m[0], isMath: true });
        pos = m.index + m[0].length;
      }
      if (pos < t.length) segments.push({ text: t.slice(pos), isMath: false });
      // Di segmen non-math, bungkus LaTeX mentah dalam $...$
      return segments.map(seg => {
        if (seg.isMath) return seg.text;
        let s = seg.text;
        // Wrap \frac{...}{...}, \sqrt{...} sebagai display $$...$$
        s = s.replace(/(\\(?:frac\{[^}]*\}\{[^}]*\}|sqrt\{[^}]*\}))/g, '$$$1$$');
        // Wrap semua LaTeX command lain dan ^/_ patterns sebagai inline $...$
        s = s.replace(/(\\[a-zA-Z]+(?:\{[^}]*\})?(?:\^\{[^}]*\})?(?:_\{[^}]*\})?|\^\{[^}]*\}|_\{[^}]*\}|\^[a-zA-Z0-9]|_[a-zA-Z0-9])/g, '$$$1$');
        return s;
      }).join('');
    };

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
      pertanyaan = collapseNewlines(pertanyaan);
      pertanyaan = cleanReferenceTraces(pertanyaan);
      pertanyaan = normalizeMath(pertanyaan, false);
      pertanyaan = wrapBareLatex(pertanyaan);

      return {
        mapel: s.mapel || mapel,
        pertanyaan,
        opsi_a: cleanReferenceTraces(wrapBareLatex(normalizeMath(opsiA, true))),
        opsi_b: cleanReferenceTraces(wrapBareLatex(normalizeMath(opsiB, true))),
        opsi_c: cleanReferenceTraces(wrapBareLatex(normalizeMath(opsiC, true))),
        opsi_d: cleanReferenceTraces(wrapBareLatex(normalizeMath(opsiD, true))),
        opsi_e: cleanReferenceTraces(wrapBareLatex(normalizeMath(opsiE, true))),
        kunci_jawaban: jawaban,
        tipe_soal: tipe,
      };
    });
  },

  // --- KATEX RENDER ---
  _renderMathInContainer(container) {
    if (typeof katex === 'undefined') return;
    const selectors = '.teks-pertanyaan, .opsi-text, ul li div';
    // Step 1: Render KaTeX $$...$$ (display mode)
    container.querySelectorAll(selectors).forEach(el => {
      if (!el.dataset.mathRendered && el.innerHTML.includes('$$')) {
        el.innerHTML = el.innerHTML.replace(/\$\$([\s\S]+?)\$\$/g, (_, formula) => {
          try { return katex.renderToString(formula.trim(), { displayMode: true, throwOnError: false }); }
          catch { return `<code>$$${formula}$$</code>`; }
        });
        el.dataset.mathRendered = '1';
      }
    });
    // Step 2: Render KaTeX $...$ (inline mode)
    container.querySelectorAll(selectors).forEach(el => {
      if (!el.dataset.mathInlineDone && el.innerHTML.includes('$')) {
        el.innerHTML = el.innerHTML.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_, formula) => {
          try { return katex.renderToString(formula.trim(), { displayMode: false, throwOnError: false }); }
          catch { return `<code>$${formula}$</code>`; }
        });
        el.dataset.mathInlineDone = '1';
      }
    });
    // Step 3: Convert remaining ^N superscript in plain text only (skip KaTeX-rendered elements)
    container.querySelectorAll(selectors).forEach(el => {
      if (!el.dataset.supDone) {
        el.querySelectorAll('span:not(.katex):not(.katex-mathml), div:not(.katex-display)').forEach(node => {
          if (!node.closest('.katex') && !node.classList.contains('katex')) {
            node.innerHTML = node.innerHTML.replace(/\^(\d+)/g, '<sup>$1</sup>');
          }
        });
        el.dataset.supDone = '1';
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
