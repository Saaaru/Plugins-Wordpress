/**
 * licitaciones_download.js — Descarga masiva de adjuntos de LICITACIONES.
 *
 * CÓMO SE INYECTA: el manifest NO inyecta content scripts en www.mercadopublico.cl
 * (solo en compra-agil), pese a tener site access. Por eso el background inyecta
 * este archivo PROGRAMÁTICAMENTE en el frame TOP (Menu.aspx) vía chrome.scripting.
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

    // Anti-doble inyección (manifest en compra-agil + inyección programática).
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
        return (name || 'documento').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim() || 'documento';
    }
    function getLicitacionCode(doc) {
        const txt = (doc && doc.body ? doc.body.innerText : '') || '';
        const m = txt.match(LIC_CODE_RE);
        return m ? m[0] : 'Licitacion';
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
        doc.querySelectorAll('a[href*="Page$"]').forEach(a => {
            const m = (a.getAttribute('href') || '').match(/Page\$(\d+)/);
            if (m) max = Math.max(max, parseInt(m[1], 10));
        });
        return max;
    }
    async function fetchVoucherPage(enc, page, prevFormState) {
        const url = `https://www.mercadopublico.cl/bid/modules/bid/voucherview.aspx?enc=${encodeURIComponent(enc)}`;
        if (page === 1 || !prevFormState) {
            const r = await fetch(url, { credentials: 'include' });
            if (!r.ok) throw new Error(`GET voucher página ${page}: HTTP ${r.status}`);
            return await r.text();
        }
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(prevFormState)) params.append(k, v);
        params.append('__EVENTTARGET', GRID_UNIQUE_ID);
        params.append('__EVENTARGUMENT', `Page$${page}`);
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
            credentials: 'include'
        });
        if (!r.ok) throw new Error(`POST voucher página ${page}: HTTP ${r.status}`);
        return await r.text();
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
            for (let page = 1; page <= totalPages; page++) {
                if (page > 1) {
                    html = await fetchVoucherPage(enc, page, formState);
                    doc = new DOMParser().parseFromString(html, 'text/html');
                    formState = parseFormState(doc);
                }
                const files = parseFiles(doc);
                if (files.length === 0) continue;
                button.textContent = `⏳${page}/${totalPages}`;
                const resp = await chrome.runtime.sendMessage({
                    action: 'downloadVoucherFiles', formState, enc, files, rootFolder
                });
                const got = (resp && typeof resp.downloaded === 'number') ? resp.downloaded : 0;
                totalDownloaded += got;
                dbg(`Página ${page}/${totalPages}: ${got}/${files.length}.`);
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

    // Inyecta 📥 en TODOS los docs (TOP + iframes mismo origen).
    function injectButtons() {
        const docs = collectDocs();
        let added = 0, totalComprobante = 0;
        for (const doc of docs) {
            const buttons = doc.querySelectorAll(COMPROBANTE_SEL);
            totalComprobante += buttons.length;
            if (buttons.length === 0) continue;
            const code = getLicitacionCode(doc);
            buttons.forEach(btn => {
                if (btn.getAttribute(ATTACHED_ATTR)) return;
                const enc = extractEncFromButton(btn);
                if (!enc) return;
                btn.setAttribute(ATTACHED_ATTR, '1');
                const dl = buildDownloadButton();
                dl.addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    downloadOffer(enc, findProviderName(btn), code, dl);
                });
                btn.insertAdjacentElement('afterend', dl);
                added++;
            });
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
        if (!__reported || __cycle % 5 === 0) { __reported = true; reportSW(comprobante); }
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
