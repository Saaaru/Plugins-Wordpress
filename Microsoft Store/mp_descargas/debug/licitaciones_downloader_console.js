/*
 * ============================================================================
 *  DESCARGA MASIVA LICITACIONES — Script de consola (mundo MAIN)
 *  Funciona SIN depender de la inyección de la extensión (by-passa el bloqueo
 *  de Edge). Lo pegas en la página de "Resumen de ofertas" (grdSupplies).
 * ============================================================================
 *
 *  CÓMO USAR:
 *    1. Navega hasta VER la tabla de ofertas (grdSupplies / "Resumen de ofertas").
 *    2. F12 → Console (contexto "top").
 *    3. Pega TODO este archivo y pulsa Enter.
 *    4. Junto a cada botón "Comprobante de oferta" aparecerá un botón 📥.
 *    5. Pulsa 📥 en una oferta → descarga TODOS sus adjuntos (todas las páginas)
 *       en Descargas/Licitacion_<código>/<proveedor>/.
 *
 *  Notas:
 *    - Corre en el mundo MAIN: acceso total al DOM y fetch mismo origen.
 *    - El naming con subcarpetas (Licitacion_…/proveedor/archivo.pdf) funciona
 *      vía el atributo download (Chromium crea las subcarpetas en Descargas).
 *    - Acepta el diálogo de "varias descargas" si Edge lo pregunta (1 vez).
 * ============================================================================
 */
(function () {
    'use strict';

    const COMPROBANTE_SEL = 'input[type="image"][onclick*="voucherview.aspx?enc="]';
    const ENC_RE = /voucherview\.aspx\?enc=([^'"]+)/;
    const LIC_CODE_RE = /\b\d{3,}-\d+-L\d{2,}\b/;
    const GRID_UNIQUE_ID = 'UcVoucherView1$DWNL$grdId';
    const ATTACHED_ATTR = 'data-mp-dl-attached';

    function sanitize(name) {
        return (name || 'documento').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim() || 'documento';
    }
    function getLicitacionCode(doc) {
        if (doc) {
            // 1) Texto visible del frame
            const m1 = ((doc.body && doc.body.innerText) || '').match(LIC_CODE_RE);
            if (m1) return m1[0];
            // 2) onclick ver_declaracion('rut','CODIGO') en la grilla
            const btn = doc.querySelector('input[onclick*="ver_declaracion"]');
            if (btn) {
                const m2 = (btn.getAttribute('onclick') || '').match(/'(\d{3,}-\d+-L\d{2,})'/);
                if (m2) return m2[1];
            }
            // 3) Cualquier atributo onclick con el código
            const any = doc.querySelector('[onclick*="-L"]');
            if (any) {
                const m3 = (any.getAttribute('onclick') || '').match(LIC_CODE_RE);
                if (m3) return m3[0];
            }
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

    // Busca comprobante buttons en TODO el árbol de frames mismo origen.
    let __dbgDocs = [];
    function findButtons() {
        const out = [];
        __dbgDocs = [];
        const seen = new Set();
        (function walk(win) {
            if (seen.has(win)) return;
            seen.add(win);
            let doc;
            try { doc = win.document; } catch (e) { __dbgDocs.push({ url: '(cross-origin)', imgs: 0, comp: 0 }); return; }
            const url = (doc.location && doc.location.href || '').split('?')[0];
            const imgs = doc.querySelectorAll('input[type="image"]').length;
            const btns = doc.querySelectorAll(COMPROBANTE_SEL);
            __dbgDocs.push({ url, imgs, comp: btns.length });
            btns.forEach(b => {
                const enc = extractEncFromButton(b);
                if (enc) out.push({ btn: b, enc, doc, provider: findProviderName(b) });
            });
            const ifrs = doc.querySelectorAll('iframe');
            for (const ifr of ifrs) {
                try { if (ifr.contentWindow) walk(ifr.contentWindow); } catch (e) { }
            }
        })(window);
        return out;
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

    const voucherUrl = (enc) =>
        `https://www.mercadopublico.cl/bid/modules/bid/voucherview.aspx?enc=${encodeURIComponent(enc)}`;

    async function fetchVoucherPage(enc, page, prevFormState) {
        const url = voucherUrl(enc);
        if (page === 1 || !prevFormState) {
            const r = await fetch(url, { credentials: 'include' });
            if (!r.ok) throw new Error(`GET página ${page}: HTTP ${r.status}`);
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
        if (!r.ok) throw new Error(`POST página ${page}: HTTP ${r.status}`);
        return await r.text();
    }

    // Descarga un archivo (POST "Ver Anexo") y lo guarda vía <a download>.
    async function downloadOneFile(enc, formState, buttonName, relativePath) {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(formState)) params.append(k, v);
        params.append('__EVENTTARGET', '');
        params.append('__EVENTARGUMENT', '');
        params.append(`${buttonName}.x`, '1');
        params.append(`${buttonName}.y`, '1');
        const r = await fetch(voucherUrl(enc), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
            credentials: 'include'
        });
        if (!r.ok) throw new Error(`Archivo HTTP ${r.status}`);
        const ct = r.headers.get('content-type') || '';
        if (/html|json|text\/plain/i.test(ct)) return false; // no es binario
        const blob = await r.blob();
        if (!blob || blob.size === 0) return false;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = relativePath; // acepta "carpeta/sub/archivo.pdf"
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return true;
    }

    async function downloadOffer(enc, providerName, doc, button) {
        if (button.disabled) return;
        const code = getLicitacionCode(doc);
        const rootFolder = `Licitacion_${code}/${sanitize(providerName)}`;
        const origText = button.textContent;
        button.disabled = true;
        let total = 0;
        try {
            let html = await fetchVoucherPage(enc, 1, null);
            let vdoc = new DOMParser().parseFromString(html, 'text/html');
            let formState = parseFormState(vdoc);
            const totalPages = parseTotalPages(vdoc);
            console.log(`[DL] Oferta "${providerName}" — ${totalPages} pág., carpeta "${rootFolder}".`);
            for (let page = 1; page <= totalPages; page++) {
                if (page > 1) {
                    html = await fetchVoucherPage(enc, page, formState);
                    vdoc = new DOMParser().parseFromString(html, 'text/html');
                    formState = parseFormState(vdoc);
                }
                const files = parseFiles(vdoc);
                if (files.length === 0) continue;
                button.textContent = `⏳${page}/${totalPages}`;
                for (let i = 0; i < files.length; i++) {
                    const f = files[i];
                    const ok = await downloadOneFile(enc, formState, f.buttonName, `${rootFolder}/${f.filename}`);
                    if (ok) total++;
                    button.title = `Pág ${page}/${totalPages} · archivo ${i + 1}/${files.length}`;
                    await new Promise(r => setTimeout(r, 500)); // rate-limit
                }
                console.log(`[DL] Página ${page}/${totalPages}: ${files.length} archivos procesados.`);
            }
            button.textContent = '✅';
            console.log(`[DL] Oferta "${providerName}" COMPLETADA: ${total} archivo(s).`);
        } catch (err) {
            console.error('[DL] Error oferta', providerName, err);
            button.textContent = '❌';
            button.title = 'Error: ' + (err && err.message);
        } finally {
            setTimeout(() => { button.disabled = false; button.textContent = origText; }, 4000);
        }
    }

    function buildButton() {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = '📥';
        b.title = 'Descargar todos los adjuntos de esta oferta';
        Object.assign(b.style, {
            marginLeft: '4px', padding: '2px 6px', backgroundColor: '#00549f', color: '#fff',
            border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
            fontWeight: 'bold', verticalAlign: 'middle', lineHeight: '1'
        });
        return b;
    }

    function inject() {
        const list = findButtons();
        // Verificación de contexto: si esto NO es SupplySummary / no hay comp>0,
        // cambia el desplegable de frame de la consola y vuelve a pegar.
        console.log(`[DL] CONTEXTO ACTUAL: ${location.href} | comp en este doc: ${list.length}`);
        console.log('[DL] Frames alcanzados desde este contexto:', __dbgDocs);
        let added = 0;
        list.forEach(({ btn, enc, doc, provider }) => {
            if (btn.getAttribute(ATTACHED_ATTR)) return;
            btn.setAttribute(ATTACHED_ATTR, '1');
            const dl = buildButton();
            dl.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                downloadOffer(enc, provider, doc, dl);
            });
            btn.insertAdjacentElement('afterend', dl);
            added++;
        });
        if (added > 0) console.log(`[DL] Inyectados ${added} botones 📥 (de ${list.length} comprobante).`);
        return list.length;
    }

    // Inyección inicial + reintento por si la grilla carga tarde.
    let found = inject();
    if (found === 0) {
        console.warn('[DL] No se hallaron botones "Comprobante de oferta" ahora. Reintentando cada 1.5s durante 15s…');
    }
    let tries = 0;
    const iv = setInterval(() => {
        tries++;
        if (inject() > 0 || tries > 10) clearInterval(iv);
    }, 1500);

    console.log('[DL] Script de descarga de Licitaciones activo.');
})();
