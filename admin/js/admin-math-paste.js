// @ts-nocheck
// ============================================================
// admin-math-paste.js — Paste/Import Campuran → PNG WebP
// Menangani: Teks Latin + Rumus (MathML/OMML) + Tabel
// Strategi Simpel PNG Kompres (WebP 0.82, max 650px)
// Tanpa build tools, lazy-load via admin-core.js
// ============================================================

(function () {
    const MAX_WIDTH = 650;
    const QUALITY = 0.82;
    const PASTE_FIELD_IDS = [
        'manual-pertanyaan', 'manual-opsi-a', 'manual-opsi-b', 'manual-opsi-c', 'manual-opsi-d', 'manual-opsi-e',
        'edit-soal-pertanyaan', 'edit-soal-a', 'edit-soal-b', 'edit-soal-c', 'edit-soal-d', 'edit-soal-e'
    ];

    let katexCssCache = null;
    let katexCssFetching = null;

    async function fetchKaTeXCss() {
        if (katexCssCache) return katexCssCache;
        if (katexCssFetching) return katexCssFetching;
        katexCssFetching = fetch('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css')
            .then(r => r.text())
            .then(t => { katexCssCache = t; return t; })
            .catch(() => { katexCssCache = ''; return ''; });
        return katexCssFetching;
    }

    function isMathHtml(html) {
        if (!html) return false;
        const h = html.toLowerCase();
        return h.includes('<math') || h.includes('m:omath') || h.includes('o:math') || h.includes('katex') || h.includes('<table') || h.includes('<img');
    }

    // --- Kompresi dataUrl image -> WebP via canvas ---
    async function compressDataUrl(dataUrl, maxWidth = MAX_WIDTH, quality = QUALITY) {
        if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
        // estimasi cepat: jika sudah < 12KB jangan kompres lagi
        if (dataUrl.length < 12000) return dataUrl;
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                try {
                    let w = img.width, h = img.height;
                    if (!w || !h) { resolve(dataUrl); return; }
                    if (w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) { resolve(dataUrl); return; }
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, w, h);
                    ctx.drawImage(img, 0, 0, w, h);
                    let out = '';
                    try { out = canvas.toDataURL('image/webp', quality); } catch (e) { }
                    if (!out || out === 'data:,' || !out.includes('image/webp')) {
                        try { out = canvas.toDataURL('image/png'); } catch (e2) { resolve(dataUrl); return; }
                    }
                    // jika hasil malah lebih besar, pakai original
                    if (out.length > dataUrl.length) resolve(dataUrl);
                    else resolve(out);
                } catch (e) { resolve(dataUrl); }
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
        });
    }

    // --- MathML -> LaTeX (cover SMK: frac, sqrt, sup/sub, mtable) ---
    function mathMlNodeToLatex(node) {
        if (!node) return '';
        if (node.nodeType === 3) {
            const t = node.textContent || '';
            // normalisasi spasi, hindari kosong
            return t.trim() ? t.trim() + ' ' : '';
        }
        if (node.nodeType !== 1) return '';
        const tag = (node.tagName || '').toLowerCase().replace(/^m:/, '').replace(/^o:/, '');
        const children = Array.from(node.childNodes);
        const childLatex = (arr) => arr.map(mathMlNodeToLatex).join('').trim();
        const first = (n) => {
            const els = Array.from(n.childNodes).filter(c => c.nodeType === 1);
            return els;
        };

        switch (tag) {
            case 'math':
            case 'semantics':
                // semantics: ambil anak pertama yang bukan annotation
                {
                    const els = children.filter(c => c.nodeType === 1 && !c.tagName.toLowerCase().includes('annotation'));
                    if (els.length) return els.map(mathMlNodeToLatex).join(' ').trim();
                    return childLatex(children);
                }
            case 'mrow':
            case 'mstyle':
            case 'mpadded':
            case 'mphantom':
            case 'menclose':
            case 'mtd':
            case 'mtr':
                return childLatex(children);
            case 'mi':
            case 'mn':
            case 'mo':
            case 'ms':
            case 'mtext':
                {
                    let txt = (node.textContent || '').trim();
                    // map beberapa operator unicode ke latex
                    const map = { '±': '\\pm ', '×': '\\times ', '÷': '\\div ', '≠': '\\neq ', '≤': '\\leq ', '≥': '\\geq ', '∞': '\\infty ', 'π': '\\pi ', 'α': '\\alpha ', 'β': '\\beta ', 'θ': '\\theta ', 'Δ': '\\Delta ', '→': '\\to ', '≈': '\\approx ', '·': '\\cdot ' };
                    if (map[txt]) return map[txt];
                    // escape untuk latex jika perlu
                    if (tag === 'mo' && txt === '-') return '-';
                    return txt + ' ';
                }
            case 'mfrac': {
                const els = first(node);
                if (els.length >= 2) return `\\frac{${mathMlNodeToLatex(els[0]).trim()}}{${mathMlNodeToLatex(els[1]).trim()}} `;
                return childLatex(children);
            }
            case 'msqrt': {
                const els = first(node);
                if (els.length) return `\\sqrt{${mathMlNodeToLatex(els[0]).trim()}} `;
                return `\\sqrt{${childLatex(children).trim()}} `;
            }
            case 'mroot': {
                const els = first(node);
                if (els.length >= 2) return `\\sqrt[${mathMlNodeToLatex(els[1]).trim()}]{${mathMlNodeToLatex(els[0]).trim()}} `;
                return childLatex(children);
            }
            case 'msup': {
                const els = first(node);
                if (els.length >= 2) return `${mathMlNodeToLatex(els[0]).trim()}^{${mathMlNodeToLatex(els[1]).trim()}} `;
                return childLatex(children);
            }
            case 'msub': {
                const els = first(node);
                if (els.length >= 2) return `${mathMlNodeToLatex(els[0]).trim()}_{${mathMlNodeToLatex(els[1]).trim()}} `;
                return childLatex(children);
            }
            case 'msubsup': {
                const els = first(node);
                if (els.length >= 3) return `${mathMlNodeToLatex(els[0]).trim()}_{${mathMlNodeToLatex(els[1]).trim()}}^{${mathMlNodeToLatex(els[2]).trim()}} `;
                return childLatex(children);
            }
            case 'mover': {
                const els = first(node);
                if (els.length >= 2) {
                    const base = mathMlNodeToLatex(els[0]).trim();
                    const over = mathMlNodeToLatex(els[1]).trim();
                    if (over === '→' || over === '&#8594;' || over === '\\to') return `\\vec{${base}} `;
                    if (over === '^' || over === '⌃') return `\\hat{${base}} `;
                    return `\\overset{${over}}{${base}} `;
                }
                return childLatex(children);
            }
            case 'munder': {
                const els = first(node);
                if (els.length >= 2) return `\\underset{${mathMlNodeToLatex(els[1]).trim()}}{${mathMlNodeToLatex(els[0]).trim()}} `;
                return childLatex(children);
            }
            case 'munderover': {
                const els = first(node);
                if (els.length >= 3) return `${mathMlNodeToLatex(els[0]).trim()}_{${mathMlNodeToLatex(els[1]).trim()}}^{${mathMlNodeToLatex(els[2]).trim()}} `;
                return childLatex(children);
            }
            case 'mfenced': {
                const open = node.getAttribute('open') || '(';
                const close = node.getAttribute('close') || ')';
                const inner = childLatex(children).trim();
                return `\\left${open} ${inner} \\right${close} `;
            }
            case 'mtable':
            case 'matrix': {
                const rows = Array.from(node.children).filter(c => c.tagName && c.tagName.toLowerCase().includes('mtr'));
                if (!rows.length) return childLatex(children);
                const rowLatex = rows.map(r => {
                    const cells = Array.from(r.children).filter(c => c.tagName && c.tagName.toLowerCase().includes('mtd'));
                    return cells.map(c => mathMlNodeToLatex(c).trim()).join(' & ');
                }).join(' \\\\ ');
                return `\\begin{matrix} ${rowLatex} \\end{matrix} `;
            }
            case 'annotation':
            case 'annotation-xml':
                return '';
            default:
                return childLatex(children);
        }
    }

    function mathElementToLatex(mathEl) {
        try {
            const latex = mathMlNodeToLatex(mathEl).replace(/\s+/g, ' ').trim();
            return latex || (mathEl.textContent || '').trim();
        } catch (e) { return (mathEl.textContent || '').trim(); }
    }

    // --- LaTeX -> WebP via KaTeX + SVG foreignObject ---
    async function latexToWebP(latex) {
        if (!latex) return null;
        // batasi panjang latex biar tidak overload
        if (latex.length > 600) latex = latex.substring(0, 600);
        try {
            if (typeof katex !== 'undefined') {
                const css = await fetchKaTeXCss();
                const html = katex.renderToString(latex, { throwOnError: false, displayMode: false, strict: false });
                const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="80"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="background:white;"><style>${css}</style><div style="font-size:18px;padding:6px 8px;display:inline-block;background:white;color:black;">${html}</div></div></foreignObject></svg>`;
                const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const dataUrl = await new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => {
                        try {
                            const canvas = document.createElement('canvas');
                            // estimasi ukuran dari latex panjang
                            const estW = Math.min(650, Math.max(120, latex.length * 9 + 40));
                            const estH = 48;
                            canvas.width = estW * 2; canvas.height = estH * 2;
                            const ctx = canvas.getContext('2d');
                            ctx.fillStyle = '#ffffff';
                            ctx.fillRect(0, 0, canvas.width, canvas.height);
                            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                            URL.revokeObjectURL(url);
                            let out = canvas.toDataURL('image/webp', QUALITY);
                            if (!out.includes('image/webp')) out = canvas.toDataURL('image/png');
                            resolve(out);
                        } catch (e) { URL.revokeObjectURL(url); reject(e); }
                    };
                    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg load fail')); };
                    img.src = url;
                });
                // kompres lagi jika masih besar
                return await compressDataUrl(dataUrl);
            }
        } catch (e) { }
        // fallback: canvas text sederhana
        try {
            const canvas = document.createElement('canvas');
            canvas.width = Math.min(650, Math.max(200, latex.length * 8 + 40));
            canvas.height = 40;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#0f172a'; ctx.font = '16px serif'; ctx.textBaseline = 'middle';
            ctx.fillText(latex.substring(0, 60), 10, 20);
            let out = canvas.toDataURL('image/webp', QUALITY);
            if (!out.includes('image/webp')) out = canvas.toDataURL('image/png');
            return out;
        } catch (e) { return null; }
    }

    // --- SVG/MathML element -> WebP fallback for MathJax chtml ---
    async function elementToWebPViaCanvas(el) {
        try {
            const rect = el.getBoundingClientRect();
            if (!rect.width || !rect.height) return null;
            const canvas = document.createElement('canvas');
            const scale = 2;
            canvas.width = Math.min(MAX_WIDTH * scale, Math.round(rect.width * scale));
            canvas.height = Math.round(rect.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            // teknik foreignObject: serialize el outerHTML
            const css = await fetchKaTeXCss();
            const html = el.innerHTML;
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:16px;background:white;"><style>${css}</style>${html}</div></foreignObject></svg>`;
            const blob = new Blob([svg], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const dataUrl = await new Promise((res, rej) => {
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    URL.revokeObjectURL(url);
                    let out = canvas.toDataURL('image/webp', QUALITY);
                    if (!out.includes('image/webp')) out = canvas.toDataURL('image/png');
                    res(out);
                };
                img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img err')); };
                img.src = url;
            });
            return dataUrl;
        } catch (e) { return null; }
    }

    // --- Core: Convert clipboard HTML campuran -> HTML siap insert (PNG WebP) ---
    async function convertHtmlMixed(html) {
        if (!html || !isMathHtml(html)) return html;
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // 1. hapus tag berbahaya & mso
        doc.querySelectorAll('script, style, meta, link, xml, o\\:p').forEach(n => n.remove());
        doc.body.querySelectorAll('*').forEach(el => {
            [...el.attributes].forEach(attr => {
                if (attr.name.toLowerCase().startsWith('on')) el.removeAttribute(attr.name);
            });
            // hapus style mso
            const s = el.getAttribute('style');
            if (s && s.toLowerCase().includes('mso-')) el.removeAttribute('style');
        });

        // 2. proses MathML -> PNG
        // Word kadang pakai <math> tanpa namespace + fallback <img> sebelahnya
        const maths = Array.from(doc.querySelectorAll('math, m\\:math, span.katex-mathml math'));
        // juga cari math dengan query lebih luas via getElementsByTagName
        const extraMaths = Array.from(doc.getElementsByTagName('math'));
        const allMaths = [...new Set([...maths, ...extraMaths])];

        for (const math of allMaths) {
            // cek apakah ini sudah di dalam span.katex yang akan kita proses sekali
            if (math.closest && math.closest('span.katex-mathml')) {
                // akan diproses via math itu sendiri, skip duplikasi parent
            }
            try {
                // cek fallback img di sebelah math (Word pattern: <math>...</math><img src="data:...">)
                let fallbackImg = null;
                let nxt = math.nextElementSibling;
                if (nxt && nxt.tagName.toLowerCase() === 'img' && nxt.src && nxt.src.startsWith('data:')) fallbackImg = nxt;
                // juga cek previous sibling img (Google Docs kadang terbalik)
                if (!fallbackImg) {
                    let prv = math.previousElementSibling;
                    if (prv && prv.tagName.toLowerCase() === 'img' && prv.src && prv.src.startsWith('data:')) fallbackImg = prv;
                }
                let webp = null;
                if (fallbackImg) {
                    webp = await compressDataUrl(fallbackImg.src);
                    const img = doc.createElement('img');
                    img.src = webp;
                    img.alt = fallbackImg.alt || math.textContent?.trim().substring(0, 40) || 'rumus';
                    img.setAttribute('data-source', 'paste-math-fallback');
                    img.setAttribute('data-latex', mathElementToLatex(math).substring(0, 200));
                    img.style.cssText = 'max-width:100%;height:auto;display:inline-block;vertical-align:middle;margin:2px 4px;border-radius:4px;';
                    // ganti math dengan img, hapus fallback
                    math.replaceWith(img);
                    fallbackImg.remove();
                } else {
                    const latex = mathElementToLatex(math);
                    if (!latex) { math.remove(); continue; }
                    let webp2 = await latexToWebP(latex);
                    if (webp2) {
                        const img = doc.createElement('img');
                        img.src = webp2;
                        img.alt = latex.substring(0, 80);
                        img.setAttribute('data-latex', latex.substring(0, 300));
                        img.setAttribute('data-source', 'paste-math-ml2png');
                        img.style.cssText = 'max-width:100%;height:auto;display:inline-block;vertical-align:middle;margin:2px 4px;border-radius:4px;';
                        math.replaceWith(img);
                    } else {
                        // fallback: ganti dengan \(latex\) text agar KaTeX bisa render nanti
                        const span = doc.createElement('span');
                        span.textContent = `\\(${latex}\\)`;
                        math.replaceWith(span);
                    }
                }
            } catch (e) {
                console.warn('math convert fail', e);
            }
        }

        // 3. proses sisa <span class="katex"> yang bukan math (Google Docs)
        const katexSpans = Array.from(doc.querySelectorAll('span.katex'));
        for (const ks of katexSpans) {
            // jika sudah berisi img hasil step 2, skip
            if (ks.querySelector('img')) continue;
            // coba ekstrak latex dari annotation
            const ann = ks.querySelector('annotation[encoding="application/x-tex"]');
            if (ann && ann.textContent) {
                const latex = ann.textContent.trim();
                try {
                    const webp = await latexToWebP(latex);
                    if (webp) {
                        const img = doc.createElement('img');
                        img.src = webp;
                        img.alt = latex.substring(0, 80);
                        img.setAttribute('data-latex', latex.substring(0, 300));
                        img.style.cssText = 'max-width:100%;height:auto;display:inline-block;vertical-align:middle;margin:2px 4px;border-radius:4px;';
                        ks.replaceWith(img);
                    }
                } catch (e) { }
            }
        }

        // 4. kompres semua img data: yang tersisa (gambar biasa, tabel image, dll)
        const imgs = Array.from(doc.querySelectorAll('img'));
        for (const img of imgs) {
            if (img.src && img.src.startsWith('data:')) {
                try {
                    const c = await compressDataUrl(img.src);
                    img.src = c;
                    img.style.cssText = 'max-width:100%;height:auto;display:block;margin:6px 0;border-radius:6px;';
                    if (!img.alt) img.alt = 'gambar';
                } catch (e) { }
            } else if (img.src) {
                img.style.cssText = 'max-width:100%;height:auto;display:block;margin:6px 0;border-radius:6px;';
            }
        }

        // 5. rapikan tabel: bungkus dengan wrapper responsif, bersihkan style berlebih
        const tables = Array.from(doc.querySelectorAll('table'));
        for (const table of tables) {
            // bersihkan style inline Word yang bikin rusak
            table.querySelectorAll('*').forEach(el => {
                const s = el.getAttribute('style');
                if (s) {
                    // pertahankan border saja, hapus mso
                    if (s.toLowerCase().includes('mso-') || s.includes('width:')) el.removeAttribute('style');
                }
                // hapus class Word
                if (el.getAttribute('class') && el.getAttribute('class').toLowerCase().includes('mso')) el.removeAttribute('class');
            });
            table.style.cssText = 'width:100%;border-collapse:collapse;min-width:400px;';
            // jika belum dibungkus, bungkus
            if (!table.parentElement || !table.parentElement.classList.contains('table-responsive-wrapper')) {
                const wrap = doc.createElement('div');
                wrap.className = 'table-responsive-wrapper';
                wrap.style.cssText = 'width:100%;overflow-x:auto;margin:12px 0;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(15,23,42,0.35);-webkit-overflow-scrolling:touch;';
                table.parentNode.insertBefore(wrap, table);
                wrap.appendChild(table);
            }
        }
        // juga bungkus div yang sudah berisi table tapi belum wrapper (Word kadang table di dalam div)
        doc.querySelectorAll('div').forEach(div => {
            if (div.classList.contains('table-responsive-wrapper')) return;
            if (div.querySelector('table') && div.children.length === 1 && div.children[0].tagName.toLowerCase() === 'table') {
                div.className = 'table-responsive-wrapper';
                div.style.cssText = 'width:100%;overflow-x:auto;margin:12px 0;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(15,23,42,0.35);';
            }
        });

        // 6. allowlist sederhana: hapus atribut on*, tapi biarkan b,i,u,sub,sup, etc
        doc.body.querySelectorAll('*').forEach(el => {
            [...el.attributes].forEach(a => {
                if (a.name.toLowerCase().startsWith('on')) el.removeAttribute(a.name);
                if (a.name.toLowerCase() === 'style' && el.tagName.toLowerCase() === 'span' && !el.style.cssText.includes('max-width')) {
                    // biarkan style KaTeX jika ada? tapi KaTeX sudah jadi img, jadi aman hapus style kosong
                }
            });
        });

        return doc.body.innerHTML.trim();
    }

    // --- Paste handler untuk 1 field ---
    async function attachMathPasteHandler(id) {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.dataset.mathPasteAttached === '1') return;
        el.dataset.mathPasteAttached = '1';

        el.addEventListener('paste', async (e) => {
            const html = e.clipboardData ? e.clipboardData.getData('text/html') : '';
            const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
            if (!html || !isMathHtml(html)) return; // biarkan default untuk teks biasa

            // jika hanya teks biasa tanpa math/table/img, biarkan default
            const hasMathOrTable = /<math|<table|<img|o:math|katex/i.test(html);
            if (!hasMathOrTable) return;

            // batas: hitung rumus sudah ada
            const existingImgs = el.querySelectorAll('img[data-source^="paste-math"]').length;
            const incomingImgs = (html.match(/<math|<img/gi) || []).length;
            if (existingImgs + incomingImgs > 8) {
                if (typeof showToast === 'function') showToast('Maksimal 8 rumus/gambar per field. Kurangi paste.', 'error');
                // tetap lanjutkan tapi warning
            }

            e.preventDefault();
            el.focus();
            // tampilkan loading kecil
            const sel = window.getSelection();
            const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;

            try {
                if (typeof showToast === 'function') {
                    // tidak spam toast
                }
                const converted = await convertHtmlMixed(html);
                // insert di posisi kursor
                if (range) {
                    // hapus seleksi
                    range.deleteContents();
                    const tmp = document.createElement('div');
                    tmp.innerHTML = converted;
                    const frag = document.createDocumentFragment();
                    while (tmp.firstChild) frag.appendChild(tmp.firstChild);
                    range.insertNode(frag);
                    // pindah kursor ke akhir
                    range.collapse(false);
                    sel.removeAllRanges();
                    sel.addRange(range);
                } else {
                    // fallback execCommand
                    document.execCommand('insertHTML', false, converted);
                }
                // trigger input event agar auto-save / deteksi perubahan
                el.dispatchEvent(new Event('input', { bubbles: true }));
                if (typeof renderKaTeXInElement === 'function' && el.textContent.includes('\\(')) {
                    try { renderKaTeXInElement(el); } catch (e2) { }
                }
                if (typeof showToast === 'function') showToast('Rumus/tabel berhasil ditempel (otomatis terkompresi)', 'success');
            } catch (err) {
                console.error('math paste error', err);
                try { document.execCommand('insertText', false, text); } catch (e2) { }
                if (typeof showToast === 'function') showToast('Gagal konversi rumus, ditempel sebagai teks', 'error');
            }
        });
    }

    // --- Patch insertImageToEditor agar kompres ---
    function patchImageInsert() {
        if (typeof window.insertImageToEditor === 'function' && !window.insertImageToEditor.__patched) {
            const orig = window.insertImageToEditor;
            window.insertImageToEditor = async function (targetId, input) {
                const file = input.files ? input.files[0] : null;
                if (!file) return;
                // jika file besar > 200KB, kompres via canvas dulu
                if (file.size > 200 * 1024 || file.type.includes('png') || file.type.includes('jpeg')) {
                    const reader = new FileReader();
                    reader.onload = async function (e) {
                        try {
                            const compressed = await compressDataUrl(e.target.result);
                            const el = document.getElementById(targetId);
                            if (!el) return;
                            el.focus();
                            const imgTag = `<img src="${compressed}" style="max-width:100%;max-height:250px;display:block;margin:6px 0;border-radius:6px;" alt="gambar">`;
                            document.execCommand('insertHTML', false, imgTag);
                            if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([el]).catch(() => { });
                            if (input) input.value = '';
                        } catch (err) { orig(targetId, input); }
                    };
                    reader.readAsDataURL(file);
                } else {
                    return orig(targetId, input);
                }
            };
            window.insertImageToEditor.__patched = true;
        }
    }

    // --- Init untuk semua field ---
    function initMathPaste() {
        PASTE_FIELD_IDS.forEach(attachMathPasteHandler);
        patchImageInsert();
        // juga pantau field yang mungkin baru muncul (modal edit)
        const observer = new MutationObserver(() => {
            PASTE_FIELD_IDS.forEach(attachMathPasteHandler);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        // expose untuk Word import
        window.convertHtmlMixed = convertHtmlMixed;
        window.compressDataUrl = compressDataUrl;
        console.log('✓ Math Paste PNG siap (', PASTE_FIELD_IDS.length, 'field )');
    }

    // expose
    window.initMathPaste = initMathPaste;
    window.convertHtmlMixed = convertHtmlMixed;

    // auto init saat DOM ready jika sudah di bank-soal
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (document.getElementById('manual-pertanyaan') || document.getElementById('edit-soal-pertanyaan')) {
                setTimeout(initMathPaste, 300);
            }
        });
    } else {
        setTimeout(() => {
            if (document.getElementById('manual-pertanyaan') || document.getElementById('edit-soal-pertanyaan')) initMathPaste();
        }, 300);
    }
})();
