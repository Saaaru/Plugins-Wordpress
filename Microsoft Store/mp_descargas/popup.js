/**
 * popup.js — Controlador del popup de la extensión MP Tools.
 *
 * Los botones de descarga de Licitaciones ahora se inyectan automáticamente
 * (content_scripts del manifest con all_frames:true), por lo que el popup ya
 * no necesita un botón manual de inyección. Aquí solo se gestiona el enlace
 * a solvitu.com abriéndolo en una pestaña nueva.
 */
(function () {
    'use strict';

    const link = document.getElementById('solvituLink');
    if (link) {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: link.href });
            window.close();
        });
    }
})();
