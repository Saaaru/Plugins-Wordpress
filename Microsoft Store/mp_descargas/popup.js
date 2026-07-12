/**
 * popup.js — Controlador del popup de la extensión MP Tools.
 *
 * Permite al usuario inyectar el script de descarga masiva de Licitaciones
 * (licitaciones_download.js) en TODOS los frames del tab activo con un solo clic,
 * sin necesidad de pegar código en la consola.
 *
 * Usa chrome.scripting.executeScript con allFrames:true, que recorre el árbol
 * interno de frames del navegador (no un walk JS), por lo que alcanza la grilla
 * grdSupplies aunque viva en un iframe anidado cross-origin respecto al top.
 */
(function () {
    'use strict';

    const INJECT_FILE = 'licitaciones_download.js';
    const ATTACHED_SEL = '[data-mp-dl-attached="1"]';

    const btn = document.getElementById('injectBtn');
    const status = document.getElementById('status');

    function setStatus(text, kind) {
        status.innerHTML = text;
        status.className = 'status ' + kind;
    }

    btn.addEventListener('click', async () => {
        btn.disabled = true;
        setStatus('Inyectando script en todos los frames…', 'loading');

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.url || !tab.url.includes('mercadopublico.cl')) {
                setStatus('⚠️ Abre primero una página de <strong>Mercado Público</strong> (Licitaciones).', 'warning');
                return;
            }

            // 1) Inyecta licitaciones_download.js en TODOS los frames del tab.
            //    El script tiene guarda anti-doble-inyección (window.__mpLicitacionesDL),
            //    así que pulsar varias veces es seguro.
            await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                files: [INJECT_FILE]
            });

            // 2) Espera al scan inicial del script (la grilla puede cargar tarde).
            await new Promise(r => setTimeout(r, 1200));

            // 3) Cuenta cuántos botones 📥 se inyectaron en todos los frames.
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: () => document.querySelectorAll('[data-mp-dl-attached="1"]').length
            });

            const total = results.reduce((sum, r) => sum + (r.result || 0), 0);

            if (total > 0) {
                setStatus(
                    `✅ <strong>${total}</strong> botón(es) 📥 inyectado(s).<br>` +
                    `Pulsa 📥 junto a cada oferta para descargar todos sus adjuntos.`,
                    'success'
                );
            } else {
                setStatus(
                    '⚠️ Script inyectado pero aún no se ven ofertas.<br>' +
                    'Si la grilla está cargando, espera unos segundos y vuelve a pulsar.',
                    'warning'
                );
            }
        } catch (err) {
            console.error('[MP Tools Popup] Error:', err);
            setStatus('❌ Error: ' + (err.message || err), 'error');
        } finally {
            btn.disabled = false;
        }
    });
})();
