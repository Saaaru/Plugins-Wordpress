/*
 * ============================================================================
 *  INSPECTOR — Descarga Licitaciones (página de ofertas / grdSupplies)
 * ============================================================================
 *
 *  CÓMO USAR (mundo MAIN):
 *    1. Estás en la página del "Resumen de ofertas" (grilla grdSupplies).
 *    2. F12 → Console (contexto "top" está bien).
 *    3. Pega TODO este archivo y pulsa Enter.
 *    4. Copia el resultado y compártelo.
 *
 *  Recorre el frame TOP + todos los iframes del mismo origen y, por cada uno,
 *  reporta:
 *    - URL del documento
 *    - si el content script licitaciones_download.js está cargado
 *      (atributo data-mp-licitaciones-dl)
 *    - cuántos botones "Comprobante de oferta" hay
 *      (input[type=image][onclick*=voucherview.aspx?enc=])
 *    - cuántos ya tienen el botón 📥 inyectado (data-mp-dl-attached)
 *
 *  Así sabemos en qué frame vive grdSupplies y si el script llegó ahí.
 * ============================================================================
 */
(function mpOffersInspect() {
    'use strict';

    const CS_ATTR = 'data-mp-licitaciones-dl';
    const COMPROBANTE_SEL = 'input[type="image"][onclick*="voucherview.aspx?enc="]';
    const INJECTED_SEL = 'input[type="image"][onclick*="voucherview.aspx?enc="][data-mp-dl-attached]';
    const GRID_SEL = 'table#grdSupplies, table[id*="grdSupplies"]';

    const seen = new Set();
    const frames = [];
    function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }

    function collectFrames(win, depth) {
        if (seen.has(win)) return;
        seen.add(win);
        frames.push({ win, depth });
        const ifrs = safe(() => win.document.querySelectorAll('iframe'), []);
        ifrs.forEach((ifr) => {
            const cw = safe(() => ifr.contentWindow, null);
            if (cw) safe(() => { void cw.document; collectFrames(cw, depth + 1); }, null);
        });
    }

    function inspectDoc(doc, label, depth) {
        const comprobante = safe(() => doc.querySelectorAll(COMPROBANTE_SEL).length, 0);
        const injected = safe(() => doc.querySelectorAll(INJECTED_SEL).length, 0);
        const grid = safe(() => doc.querySelectorAll(GRID_SEL).length, 0);
        const csLoaded = !!(doc.documentElement && doc.documentElement.getAttribute(CS_ATTR));
        const href = safe(() => doc.location.href, '(no accesible)');

        const verdict = (function () {
            if (comprobante > 0 && injected === comprobante) return '✅ botones 📥 inyectados';
            if (comprobante > 0 && csLoaded && injected === 0) return '⚠️ script cargado + botones presentes, PERO sin inyectar 📥';
            if (comprobante > 0 && !csLoaded) return '⚠️ hay botones comprobante pero el script NO está cargado en este frame';
            if (grid > 0) return 'ℹ️ grdSupplies presente (sin botones comprobante visibles aún)';
            return '— sin grdSupplies ni botones comprobante aquí';
        })();

        const info = { frame: label, depth, href, scriptLoaded: csLoaded, grdSupplies: grid, comprobante, inyectados: injected, verdict };
        console.groupCollapsed(`%c[${verdict.startsWith('✅') ? '✅' : (verdict.startsWith('⚠️') ? '⚠️' : 'ℹ️')}] ${label} (depth ${depth})`, 'font-weight:bold;');
        console.log(info);
        console.groupEnd();
        return info;
    }

    try { collectFrames(window, 0); } catch (e) { console.warn('No se pudo recorrer frames:', e); }

    console.group('%c=== MP Offers Inspector ===', 'color:#00549f;font-weight:bold;font-size:13px;');
    const results = frames.map(({ win, depth }) => {
        const label = (win === window.top) ? 'TOP' : `IFRAME#${depth}`;
        return safe(() => inspectDoc(win.document, label, depth), null);
    }).filter(Boolean);

    const frameConBotones = results.find(r => r.comprobante > 0);
    console.log('%cRESUMEN', 'font-weight:bold;');
    console.table(results.map(r => ({
        frame: r.frame, url: (r.href || '').slice(0, 60), scriptLoaded: r.scriptLoaded,
        grdSupplies: r.grdSupplies, comprobante: r.comprobante, inyectados: r.inyectados
    })));

    if (!frameConBotones) {
        console.warn('👉 No se encontraron botones "Comprobante de oferta" en NINGÚN frame. ' +
            '¿Estás en la página de "Resumen de ofertas"? Si sí, grdSupplies puede cargarse tras un postback: recarga la página (F5) y vuelve a ejecutar este inspector.');
    } else if (!frameConBotones.scriptLoaded) {
        console.warn('👉 El frame con los botones (' + (frameConBotones.frame) + ') NO tiene el content script cargado. ' +
            'Recarga la extensión y luego F5 en la página del portal para forzar la reinyección en el iframe.');
    } else if (frameConBotones.inyectados === 0) {
        console.warn('👉 El script está cargado y hay botones, pero no se inyectó 📥. Posible timing: el grdSupplies llegó tras un postback. ' +
            'Si tras F5 persiste, ajustaremos el observer.');
    } else {
        console.log('✅ Todo OK: el botón 📥 está inyectado. Si al pulsarlo no descarga, revisa los logs [Licitaciones DL] / [Voucher].');
    }
    console.groupEnd();

    mpOffersInspect.last = results;
    console.log('Resultados guardados en mpOffersInspect.last');
})();
