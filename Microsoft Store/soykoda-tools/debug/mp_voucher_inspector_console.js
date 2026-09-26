/*
 * ============================================================================
 *  INSPECTOR DE CONSOLA — Descarga Masiva Voucher (Licitaciones)
 * ============================================================================
 *
 *  CÓMO USAR (mundo MAIN, NO en el Service Worker):
 *    1. Abre la pestaña/pop-up del voucher de la licitación
 *       (https://www.mercadopublico.cl/.../voucherview.aspx?enc=...).
 *    2. Abre DevTools (F12) → pestaña "Console".
 *    3. Pega TODO este archivo en la consola y pulsa Enter.
 *    4. Copia el resultado (o haz click derecho → "Save as…") y compártelo.
 *
 *  ¿QUÉ DICE?
 *    - Para cada frame (TOP + iframes del mismo origen) vuelca:
 *        · URL y readyState
 *        · si el content script de la extensión está cargado
 *          (atributo data-mp-voucher-cs puesto por voucher_content.js)
 *        · TODOS los id de <table> (para ver si la grilla tiene otro id)
 *        · si el selector table[id*="grdId"] coincide (y su id)
 *        · cuántos botones "Ver Anexo" hay y sus name=
 *        · links de paginación, form oculto, texto "Anexos de la Oferta",
 *          código de licitación y parámetro enc
 *        - si el botón #mp-voucher-bulk-download ya existe en el DOM
 *    - Un VEREDICTO final con la causa más probable.
 *
 *  NOTA: este script corre en el mundo MAIN. NO puede ver variables internas
 *  de la extensión (chrome.runtime, etc.), PERO sí lee el DOM compartido y la
 *  marca data-mp-voucher-cs. Para ver los logs internos de la extensión
 *  ([Voucher DBG]...), revisa directamente la consola: aparecen solos al navegar.
 * ============================================================================
 */
(function mpVoucherInspect() {
    'use strict';

    const SEL = {
        grid: 'table[id*="grdId"]',
        verAnexo: 'input[type="image"][src*="ver"]',
        form: 'form#form1, form[name="form1"], form',
        pagination: 'a[href*="Page$"]',
        button: '#mp-voucher-bulk-download',
        anexosSpan: 'span[idlbl="DWNLLblMessage"]'
    };
    const CS_ATTR = 'data-mp-voucher-cs';
    const LIC_RE = /\b\d{3,}-\d+-L\d{2,}\b/;

    const seen = new Set();
    const frames = [];

    function safe(fn, fallback) {
        try { return fn(); } catch (e) { return fallback; }
    }

    // Recorre el TOP + todos los iframes del MISMO origen (accesibles).
    function collectFrames(win, depth) {
        if (seen.has(win)) return;
        seen.add(win);
        frames.push({ win, depth });
        const ifrs = safe(() => win.document.querySelectorAll('iframe'), []);
        ifrs.forEach((ifr) => {
            const cw = safe(() => ifr.contentWindow, null);
            if (cw) {
                // contentWindow existe siempre; el acceso al document lanza si es cross-origin.
                safe(() => { void cw.document; collectFrames(cw, depth + 1); }, null);
            }
        });
    }

    function inspectDoc(doc, label, depth) {
        const tables = Array.from(doc.querySelectorAll('table'));
        const tableIds = tables.map(t => t.id || t.name || '(sin id)');
        const grids = doc.querySelectorAll(SEL.grid);
        const verAnexo = Array.from(doc.querySelectorAll(SEL.verAnexo));
        const pagination = doc.querySelectorAll(SEL.pagination);
        const form = doc.querySelector(SEL.form);
        const hiddenCount = form ? form.querySelectorAll('input[type="hidden"]').length : 0;
        const bodyText = doc.body ? doc.body.innerText : '';
        const lic = (bodyText.match(LIC_RE) || [])[0] || '(no hallado)';
        const enc = safe(() => {
            const u = new URL(doc.location.href);
            return u.searchParams.get('enc') || '(ausente)';
        }, '(?)');
        const anexos = /anexos de la oferta/i.test(bodyText);
        const csLoaded = doc.documentElement && doc.documentElement.getAttribute(CS_ATTR);
        const button = doc.querySelector(SEL.button);

        const info = {
            frame: label,
            depth,
            href: safe(() => doc.location.href, '(no accesible)'),
            readyState: doc.readyState,
            contentScriptLoaded: !!csLoaded,
            contentScriptMarker: csLoaded || null,
            tableCount: tables.length,
            tableIds,
            gridSelectorMatches: grids.length,
            gridIds: Array.from(grids).map(g => g.id),
            verAnexoCount: verAnexo.length,
            verAnexoNames: verAnexo.map(b => b.name).slice(0, 12),
            paginationLinkCount: pagination.length,
            formFound: !!form,
            hiddenInputs: hiddenCount,
            anexosTextPresent: anexos,
            anexosSpanPresent: !!doc.querySelector(SEL.anexosSpan),
            licitacionCode: lic,
            encParam: enc,
            bulkButtonPresent: !!button
        };

        const verdict = (function () {
            if (!csLoaded) return '⚠️ Content script NO detectado aquí (¿host no matcheado? ¿extensión sin recargar?).';
            if (grids.length === 0) {
                if (tableIds.length) return '⚠️ No hay grilla "grdId" pero SÍ hay tablas. IDs reales: ' + tableIds.join(', ') + ' — el selector es incorrecto.';
                return '⚠️ No hay <table> ni grilla en este frame (probablemente no es el frame del voucher).';
            }
            if (verAnexo.length === 0) return '⚠️ Grilla hallada pero sin botones "Ver Anexo" (¿selector del botón cambiado?).';
            if (button) return '✅ Botón presente y grilla detectada. Si no se ve, puede ser CSS/z-index.';
            return '✅ Grilla detectada y content script cargado: el botón DEBERÍA inyectarse. Revisa logs [Voucher DBG].';
        })();

        info.__verdict = verdict;

        console.groupCollapsed(`%c[${verdict.startsWith('✅') ? '✅' : '⚠️'}] Frame ${label} (depth ${depth})`, 'font-weight:bold;');
        console.log(info);
        console.groupEnd();
        return info;
    }

    try {
        collectFrames(window, 0);
    } catch (e) {
        console.warn('No se pudo recorrer frames:', e);
    }

    console.group('%c=== MP Voucher Inspector ===', 'color:#00549f;font-weight:bold;font-size:13px;');
    const results = frames.map(({ win, depth }) => {
        const label = (win === window.top) ? 'TOP' : `IFRAME#${depth}`;
        return safe(() => inspectDoc(win.document, label, depth), null);
    }).filter(Boolean);

    // Resumen cruzado: ¿en algún frame está la grilla? ¿está el content script?
    const anyGrid = results.some(r => r.gridSelectorMatches > 0);
    const anyCS = results.some(r => r.contentScriptLoaded);
    const anyButton = results.some(r => r.bulkButtonPresent);

    console.log('%cRESUMEN', 'font-weight:bold;');
    console.table([{
        framesInspeccionados: results.length,
        contentScriptCargadoEnAlgunFrame: anyCS,
        grillaDetectadaEnAlgunFrame: anyGrid,
        botonPresenteEnAlgunFrame: anyButton
    }]);

    if (!anyCS) {
        console.warn('👉 El content script NO está cargado en NINGÚN frame. ' +
            'Verifica: (a) extensión activa y recargada tras editar archivos, ' +
            '(b) que la URL real coincida con https://*.mercadopublico.cl/* (ojo con el host apex mercadopublico.cl sin subdominio).');
    } else if (anyGrid && !anyButton) {
        console.warn('👉 Content script cargado + grilla detectada, pero botón ausente. ' +
            'Revisa los logs [Voucher DBG] en la consola: el injectVoucherButton debería decir por qué.');
    } else if (anyButton) {
        console.log('✅ El botón SÍ existe en el DOM. Si no lo ves en pantalla, inspecciona estilos (display/z-index/visibility).');
    }
    console.groupEnd();

    // Devuelve el objeto para inspección adicional:  mpVoucherInspect.last
    mpVoucherInspect.last = results;
    console.log('Resultados guardados en mpVoucherInspect.last');
})();
