/**
 * licitaciones_download.js — Descarga masiva de adjuntos de LICITACIONES.
 *
 * CÓMO SE INYECTA (definitivo): el POPUP de la extensión inyecta este archivo en
 * TODOS los frames del tab activo vía chrome.scripting.executeScript({allFrames:true}),
 * que usa el árbol interno de frames del navegador (no un walk JS) y por tanto alcanza
 * la grilla grdSupplies aunque viva en un iframe anidado. También puede inyectarse vía
 * el manifest (content_scripts, all_frames:true) si Edge lo permite; el guarda
 * window.__mpLicitacionesDL evita la doble inicialización.
 *
 * CÓMO FUNCIONA: desde el TOP recorre recursivamente los iframes del MISMO origen
 * (www.mercadopublico.cl → www.mercadopublico.cl: OpeningFrame → SupplySummary),
 * localiza la grilla grdSupplies y los botones "Ver Comprobante de oferta"
 * (imgView con onclick → voucherview.aspx?enc=…) e inyecta un 📥 junto a cada uno
 * en el DOM de ese iframe. El handler del click vive aquí (mundo aislado del TOP),
 * donde hay chrome.runtime y fetch. Al pulsarlo: obtiene el voucher por `enc` con
 * fetch, página por página (GET la 1; POST con __doPostBack para paginar), parsea
 * con DOMParser y envía cada página al background (downloadVoucherFiles), que
 * replica el POST "Ver Anexo" (captcha-free) y guarda en Licitacion_<código>/<proveedor>/.
 *
 * Polling cada ~1.5s para capturar la grilla aunque cargue tarde o tras postback.
 */
(function () {
    'use strict';

    // Anti-doble inyección: seguro contra re-ejecuciones del popup (executeScript)
    // y contra inyección simultánea del manifest. Cada frame tiene su propio window.
    if (window.__mpLicitacionesDL) return;
    window.__mpLicitacionesDL = true;

    try { document.documentElement.setAttribute('data-mp-licitaciones-dl', String(Date.now())); } catch (_) { }

    const LOG = '[Licitaciones DL]';
    const COMPROBANTE_SEL = 'input[type="image"][onclick*="voucherview.aspx?enc="]';
    const GRID_SEL = 'table[id*="grdSupplies"], table#grdSupplies';
    const ENC_RE = /voucherview\.aspx\?enc=([^'"]+)/;
    const LIC_CODE_RE = /\b\d{3,}-\d+-L\d{2,}\b/;
    const GRID_UNIQUE_ID = 'UcVoucherView1$DWNL$grdId';
    const ATTACHED_ATTR = 'data-mp-dl-attached';
    const isTop = (window === window.top);

    function dbg(...args) { console.log(LOG, ...args); }
    function sanitize(name) {
        return (name || 'documento')
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^\.+/, '')   // Windows rejects folder names starting with "."
            .replace(/\.+$/, '')   // or ending with "."
            || 'documento';
    }
    function getLicitacionCode(docs) {
        const docList = Array.isArray(docs) ? docs : [docs];
        // 1. Buscar #Lnk_ExternalCode_Value (elemento <a> con el número de licitación)
        for (const doc of docList) {
            const link = doc && doc.querySelector ? doc.querySelector('#Lnk_ExternalCode_Value') : null;
            if (link && /\d{3,}-\d+-L\d{2,}/.test(link.textContent.trim())) {
                return link.textContent.trim();
            }
        }
        // 2. Fallback: buscar el patrón en el texto de cualquier doc
        for (const doc of docList) {
            const txt = (doc && doc.body ? doc.body.innerText : '') || '';
            const m = txt.match(LIC_CODE_RE);
            if (m) return m[0];
        }
        return 'Licitacion';
    }
    function extractEncFromButton(btn) {
        const m = (btn.getAttribute('onclick') || '').match(ENC_RE);
        if (!m) return null;
        try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }
    function findProviderName(btn) {
        let node = btn.parentElement;
        while (node) {
            if (node.tagName === 'TR') {
                const prov = node.querySelector('a[id$="__GvLblProvider"], a[id*="GvLblProvider"]');
                if (prov && prov.textContent.trim()) return prov.textContent.trim();
                const offer = node.querySelector('a[id$="__GvLnkSuppliesName"], a[id*="GvLnkSuppliesName"]');
                if (offer && offer.textContent.trim()) return offer.textContent.trim();
            }
            node = node.parentElement;
        }
        return 'Oferta';
    }

    // Recorre recursivamente el TOP + iframes del mismo origen → [doc] accesibles.
    function collectDocs() {
        const docs = [];
        const seen = new Set();
        (function walk(win) {
            if (seen.has(win)) return;
            seen.add(win);
            let doc = null;
            try { doc = win.document; } catch (e) { return; } // cross-origin
            if (doc) docs.push(doc);
            const ifrs = doc ? doc.querySelectorAll('iframe') : [];
            for (const ifr of ifrs) {
                try { if (ifr.contentWindow) walk(ifr.contentWindow); } catch (e) { }
            }
        })(window);
        return docs;
    }

    function buildDownloadButton() {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = '📥';
        b.title = 'Descargar todos los adjuntos de esta oferta (Licitaciones)';
        Object.assign(b.style, {
            marginLeft: '4px', padding: '2px 6px', backgroundColor: '#00549f', color: '#fff',
            border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
            fontWeight: 'bold', verticalAlign: 'middle', lineHeight: '1'
        });
        b.addEventListener('mouseover', () => { if (!b.disabled) b.style.backgroundColor = '#0072ce'; });
        b.addEventListener('mouseout', () => { if (!b.disabled) b.style.backgroundColor = '#00549f'; });
        return b;
    }

    function parseFormState(doc) {
        const state = {};
        doc.querySelectorAll('input[type="hidden"]').forEach(h => { if (h.name) state[h.name] = h.value; });
        return state;
    }
    function parseFiles(doc) {
        const grid = doc.querySelector('table[id*="grdId"]');
        if (!grid) return [];
        const rows = Array.from(grid.querySelectorAll('tr'))
            .filter(tr => tr.querySelector('input[type="image"][name*="search"]'));
        return rows.map(tr => {
            const btn = tr.querySelector('input[type="image"][name*="search"]');
            let filename = 'documento';
            const fileSpan = tr.querySelector('span[id$="_File"]');
            if (fileSpan && fileSpan.textContent.trim()) filename = fileSpan.textContent.trim();
            else {
                const lines = (tr.textContent || '').split('\n').map(s => s.trim())
                    .filter(l => l && !/ver\s*anexo/i.test(l) && l.length > 1);
                filename = lines.slice().sort((a, b) => b.length - a.length)[0] || 'documento';
            }
            return { buttonName: btn.name, filename: sanitize(filename) };
        });
    }
    function parseTotalPages(doc) {
        let max = 1;
        const found = [];
        doc.querySelectorAll('a[href*="Page$"]').forEach(a => {
            const m = (a.getAttribute('href') || '').match(/Page\$(\d+)/);
            if (m) {
                const n = parseInt(m[1], 10);
                found.push(n);
                max = Math.max(max, n);
            }
        });
        // Also consider the current page number (rendered as a <span> in the pager,
        // not an <a>). If the current page is the highest, the anchors won't include it.
        const currentPage = detectCurrentPage(doc);
        if (currentPage !== null) max = Math.max(max, currentPage);
        dbg(`parseTotalPages — links found: [${found.join(',')}] | current page: ${currentPage} → max=${max}`);
        return max;
    }

    // DIAG: extract the real grid UniqueID from the pager's __doPostBack href.
    function extractGridUniqueID(doc) {
        const link = doc.querySelector('a[href*="Page$"]');
        if (link) {
            const m = (link.getAttribute('href') || '').match(/__doPostBack\('([^']+)'/);
            if (m) return m[1];
        }
        return GRID_UNIQUE_ID; // fallback hardcoded
    }

    // Signature of files on a page (filenames sorted) — detects true duplicate pages.
    // FIX: Previously used buttonName (e.g. "UcVoucherView1$DWNL$grdId$ctl02$search")
    // which is the SAME on every page because ASP.NET GridView reuses control names.
    // Now uses filename to detect actual content duplication.
    function filesSig(files) {
        return files.map(f => f.filename).sort().join('|');
    }

    // DIAG: detect current page number from the pager's active span.
    function detectCurrentPage(doc) {
        const grid = doc.querySelector('table[id*="grdId"]');
        if (!grid) return null;
        const rows = Array.from(grid.querySelectorAll('tr'));
        const pagerRow = rows[rows.length - 1];
        if (!pagerRow) return null;
        const span = pagerRow.querySelector('span');
        if (span) {
            const n = parseInt((span.textContent || '').trim(), 10);
            if (!isNaN(n) && n > 0) return n;
        }
        return null;
    }
    async function fetchVoucherPage(enc, page, prevFormState) {
        const url = `https://www.mercadopublico.cl/bid/modules/bid/voucherview.aspx?enc=${encodeURIComponent(enc)}`;
        if (page === 1 || !prevFormState) {
            dbg(`fetchVoucherPage — GET página ${page}`);
            const r = await fetch(url, { credentials: 'include' });
            if (!r.ok) throw new Error(`GET voucher página ${page}: HTTP ${r.status}`);
            const text = await r.text();
            dbg(`fetchVoucherPage — GET respuesta: ${text.length} chars`);
            return text;
        }
        const params = new URLSearchParams();
        // CRÍTICO: prevFormState ya incluye __EVENTTARGET/__EVENTARGUMENT (hidden fields
        // vacíos del form ASP.NET). Si se hace append() se crean claves DUPLICADAS y
        // ASP.NET lee la primera (vacía) → el servidor ignora la paginación y siempre
        // devuelve la página 1. Se eliminan antes del loop y se añaden una sola vez.
        const state = { ...prevFormState };
        delete state.__EVENTTARGET;
        delete state.__EVENTARGUMENT;
        for (const [k, v] of Object.entries(state)) params.append(k, v);
        params.append('__EVENTTARGET', GRID_UNIQUE_ID);
        params.append('__EVENTARGUMENT', `Page$${page}`);
        // DIAG: log the POST details
        dbg(`fetchVoucherPage — POST página ${page} | __EVENTTARGET="${GRID_UNIQUE_ID}" __EVENTARGUMENT="Page$${page}" | body length=${params.toString().length}`);
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
            credentials: 'include'
        });
        if (!r.ok) throw new Error(`POST voucher página ${page}: HTTP ${r.status}`);
        const text = await r.text();
        dbg(`fetchVoucherPage — POST respuesta: ${text.length} chars`);
        return text;
    }

    // Descarga un archivo individual: hace el POST "Ver Anexo" desde el content script
    // (same-origin, cookies automáticas) y envía el blob como base64 al background
    // para que lo guarde con chrome.downloads.download.
    async function downloadOneFile(enc, formState, buttonName, filename, rootFolder) {
        const params = new URLSearchParams();
        const state = { ...formState };
        delete state.__EVENTTARGET;
        delete state.__EVENTARGUMENT;
        for (const [k, v] of Object.entries(state)) params.append(k, v);
        params.append('__EVENTTARGET', '');
        params.append('__EVENTARGUMENT', '');
        params.append(`${buttonName}.x`, '1');
        params.append(`${buttonName}.y`, '1');

        const url = `https://www.mercadopublico.cl/bid/modules/bid/voucherview.aspx?enc=${encodeURIComponent(enc)}`;
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
            credentials: 'include'
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);

        const ct = r.headers.get('content-type') || '';
        if (/html|json|text\/plain/i.test(ct)) {
            dbg(`  ⚠️ "${filename}" — respuesta no binaria (content-type: "${ct}"), se omite`);
            return false;
        }

        const blob = await r.blob();
        if (!blob || blob.size === 0) {
            dbg(`  ⚠️ "${filename}" — blob vacío, se omite`);
            return false;
        }

        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });

        const safeName = sanitize(filename);
        const relativePath = `${rootFolder}/${safeName}`;

        const resp = await chrome.runtime.sendMessage({
            action: 'saveBlobAsFile',
            base64,
            filename: relativePath
        });

        const ok = resp && resp.success;
        if (!ok) {
            dbg(`  ⚠️ "${filename}" — chrome.downloads.download falló: ${(resp && resp.error) || 'unknown'}`);
        }
        return ok;
    }

    async function downloadOffer(enc, providerName, code, button) {
        if (button.disabled) return;
        const rootFolder = `Licitacion_${code}/${sanitize(providerName)}`;
        const origText = button.textContent;
        button.disabled = true;
        let totalDownloaded = 0;
        try {
            let html = await fetchVoucherPage(enc, 1, null);
            let doc = new DOMParser().parseFromString(html, 'text/html');
            let formState = parseFormState(doc);
            const totalPages = parseTotalPages(doc);
            dbg(`Oferta "${providerName}" — ${totalPages} pág., carpeta "${rootFolder}".`);
            let prevSig = null;
            for (let page = 1; page <= totalPages; page++) {
                if (page > 1) {
                    html = await fetchVoucherPage(enc, page, formState);
                    doc = new DOMParser().parseFromString(html, 'text/html');
                    formState = parseFormState(doc);
                }
                const files = parseFiles(doc);
                if (files.length === 0) {
                    dbg(`Página ${page}/${totalPages}: 0 archivos (skip).`);
                    continue;
                }
                const sig = filesSig(files);
                if (sig === prevSig) {
                    dbg(`⚠️ Página ${page} DUPLICADA (mismos archivos que la página anterior). Se finaliza.`);
                    break;
                }
                prevSig = sig;
                dbg(`Página ${page}/${totalPages}: ${files.length} archivos.`);
                button.textContent = `⏳${page}/${totalPages}`;
                let got = 0;
                for (let i = 0; i < files.length; i++) {
                    const f = files[i];
                    try {
                        const ok = await downloadOneFile(enc, formState, f.buttonName, f.filename, rootFolder);
                        if (ok) got++;
                    } catch (err) {
                        dbg(`  ⚠️ Error descargando "${f.filename}": ${err.message}`);
                    }
                    await new Promise(r => setTimeout(r, 300));
                }
                totalDownloaded += got;
                dbg(`Página ${page}/${totalPages}: descargados ${got}/${files.length}.`);
                await new Promise(r => setTimeout(r, 400));
            }
            button.textContent = '✅';
            dbg(`Oferta "${providerName}" COMPLETADA: ${totalDownloaded} archivo(s).`);
        } catch (err) {
            console.error(LOG, 'Error', providerName, err);
            button.textContent = '❌';
            button.title = 'Error: ' + (err && err.message);
        } finally {
            setTimeout(() => { button.disabled = false; button.textContent = origText; }, 4000);
        }
    }

    // ---- Botón unificado "Descargar Todo" ----

    function buildDownloadAllButton(count) {
        const b = document.createElement('button');
        b.type = 'button';
        b.id = 'mp-download-all-btn';
        b.textContent = `📥 Todo (${count})`;
        b.title = `Descargar todas las ofertas secuencialmente (${count} ofertas)`;
        Object.assign(b.style, {
            position: 'fixed', top: '8px', right: '8px', zIndex: '2147483647',
            padding: '8px 16px', backgroundColor: '#00549f', color: '#fff',
            border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
            fontWeight: 'bold', boxShadow: '0 2px 8px rgba(0,0,0,0.35)', lineHeight: '1.2'
        });
        b.addEventListener('mouseover', () => { if (!b.disabled) b.style.backgroundColor = '#0072ce'; });
        b.addEventListener('mouseout', () => { if (!b.disabled) b.style.backgroundColor = '#00549f'; });
        return b;
    }

    async function downloadAllOffers(offers, button) {
        if (button.disabled) return;
        const origText = button.textContent;
        button.disabled = true;
        let totalFiles = 0;
        try {
            for (let i = 0; i < offers.length; i++) {
                const { enc, providerName, code } = offers[i];
                button.textContent = `⏳ ${i + 1}/${offers.length}`;
                dbg(`=== Oferta ${i + 1}/${offers.length}: "${providerName}" ===`);
                // Mock button para reutilizar downloadOffer sin acoplar UI
                const mockBtn = { disabled: false, textContent: '', title: '' };
                await downloadOffer(enc, providerName, code, mockBtn);
                // downloadOffer ya loguea el total; lo aproximamos por los logs
                dbg(`=== Oferta ${i + 1}/${offers.length} finalizada ===`);
            }
            button.textContent = '✅';
            dbg(`=== DESCARGA MASIVA COMPLETADA: ${offers.length} oferta(s) procesadas ===`);
        } catch (err) {
            console.error(LOG, 'Error downloadAll', err);
            button.textContent = '❌';
            button.title = 'Error: ' + (err && err.message);
        } finally {
            setTimeout(() => { button.disabled = false; button.textContent = origText; }, 5000);
        }
    }

    // Inyecta 📥 en TODOS los docs (TOP + iframes mismo origen).
    // También inyecta un botón flotante "Descargar Todo" cuando hay 2+ ofertas.
    function injectButtons() {
        const docs = collectDocs();
        let added = 0, totalComprobante = 0;
        const allOffers = []; // { enc, providerName, code } — TODAS las ofertas
        // El código de licitación puede estar en cualquier frame (tabla HTML),
        // no necesariamente en el mismo doc que los botones de comprobante.
        const code = getLicitacionCode(docs);
        for (const doc of docs) {
            const buttons = doc.querySelectorAll(COMPROBANTE_SEL);
            totalComprobante += buttons.length;
            if (buttons.length === 0) continue;
            buttons.forEach(btn => {
                const enc = extractEncFromButton(btn);
                if (!enc) return;
                const providerName = findProviderName(btn);
                // Recolectar TODAS las ofertas (para el botón "Descargar Todo")
                allOffers.push({ enc, providerName, code });
                // Solo inyectar 📥 individual si no estaba ya adjunto
                if (btn.getAttribute(ATTACHED_ATTR)) return;
                btn.setAttribute(ATTACHED_ATTR, '1');
                const dl = buildDownloadButton();
                dl.addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    downloadOffer(enc, providerName, code, dl);
                });
                btn.insertAdjacentElement('afterend', dl);
                added++;
            });
        }
        // Crear o actualizar botón "Descargar Todo" si hay 2+ ofertas.
        if (allOffers.length >= 2) {
            for (const doc of docs) {
                if (!doc.querySelector(COMPROBANTE_SEL)) continue;
                let btnAll = doc.getElementById('mp-download-all-btn');
                if (!btnAll) {
                    btnAll = buildDownloadAllButton(allOffers.length);
                    btnAll.addEventListener('click', (e) => {
                        e.preventDefault(); e.stopPropagation();
                        const offers = btnAll.__offers || [];
                        if (offers.length > 0 && !btnAll.disabled) {
                            downloadAllOffers(offers, btnAll);
                        }
                    });
                    try { doc.body.appendChild(btnAll); } catch (_) { }
                }
                // Actualizar la lista de ofertas y el contador (salvo durante descarga activa)
                if (!btnAll.disabled) {
                    btnAll.__offers = allOffers.slice();
                    btnAll.textContent = `📥 Descargar todo (${allOffers.length})`;
                }
                break;
            }
        }
        if (added > 0) dbg(`Inyectados ${added} 📥 (comprobante vistos: ${totalComprobante}).`);
        return totalComprobante;
    }

    let __cycle = 0, __reported = false;
    function reportSW(comprobante) {
        try {
            chrome.runtime.sendMessage({
                action: 'licitacionesScanReport',
                url: location.href.split('?')[0],
                isTop,
                comprobante
            }).catch(() => { });
        } catch (_) { }
    }

    function scan() {
        let comprobante = 0;
        try { comprobante = injectButtons(); } catch (e) { console.error(LOG, 'scan error', e); }
        // FIX (Issue 2): Only report to the service worker when comprobante buttons
        // are actually found. This prevents irrelevant frames (Menu.aspx, Reloj.aspx,
        // etc.) from spamming the SW console with "comprobante:0" messages every 7.5s.
        if (comprobante > 0 && (!__reported || __cycle % 5 === 0)) {
            __reported = true;
            reportSW(comprobante);
        }
        __cycle++;
    }

    dbg('Módulo cargado.', { url: location.href.split('?')[0], isTop });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scan);
    } else {
        scan();
    }
    setInterval(scan, 1500);
})();
