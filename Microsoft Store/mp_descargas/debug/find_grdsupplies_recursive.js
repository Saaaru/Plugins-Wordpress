/*
 * Buscador RECURSIVO de la grilla grdSupplies en TODO el árbol de frames.
 * Pega en F12 → Console (contexto "top") de la página del "Resumen de ofertas".
 */
(function () {
    const CS_ATTR = 'data-mp-licitaciones-dl';
    const COMPROBANTE = 'input[type="image"][onclick*="voucherview.aspx?enc="]';
    const GRID = 'table[id*="grdSupplies"], table#grdSupplies';
    const results = [];
    const seen = new Set();

    function walk(win, path) {
        if (seen.has(win)) return;
        seen.add(win);
        let doc;
        try { doc = win.document; } catch (e) {
            results.push({ path, url: '(cross-origin, sin acceso)', csLoaded: '-', grdSupplies: '-', comprobante: '-' });
            return;
        }
        const url = (doc.location.href || '').split('?')[0];
        const grid = doc.querySelectorAll(GRID).length;
        const comp = doc.querySelectorAll(COMPROBANTE).length;
        const cs = !!(doc.documentElement && doc.documentElement.getAttribute(CS_ATTR));
        results.push({ path, url, csLoaded: cs, grdSupplies: grid, comprobante: comp });
        // Recursión en TODOS los iframes (cualquier profundidad)
        const ifrs = doc.querySelectorAll('iframe');
        for (let i = 0; i < ifrs.length; i++) {
            try { walk(ifrs[i].contentWindow, path + '/iframe[' + i + ']'); } catch (e) { /* cross-origin */ }
        }
    }
    walk(window, 'top');

    console.table(results);
    const hit = results.find(r => r.grdSupplies > 0 || r.comprobante > 0);
    if (!hit) {
        console.warn('❌ NO se encontró grdSupplies ni botones comprobante en NINGÚN frame (ninguna profundidad). ' +
            '¿Estás seguro de estar en la pestaña con el "Resumen de ofertas" abierto? Si la grilla cargó tras un postback, pulsa F5 y vuelve a ejecutar.');
    } else {
        console.log('✅ grdSupplies/comprobante ENCONTRADO en:\n', hit);
        if (!hit.csLoaded) {
            console.warn('⚠️ Ese frame NO tiene licitaciones_download.js cargado (csLoaded=false). ' +
                'El content script del manifest NO se está inyectando ahí.');
        } else if (hit.comprobante === 0) {
            console.warn('⚠️ Script cargado y grdSupplies presente, pero sin botones comprobante. Revisa el HTML de esa fila.');
        } else {
            console.log('Todo OK para ese frame. El botón 📥 debería inyectarse.');
        }
    }
    return results;
})();
