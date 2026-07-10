/**
 * voucher_content.js — Módulo "Descarga masiva de adjuntos" para LICITACIONES (Voucher View).
 *
 * Sistema objetivo: portal legacy ASP.NET WebForms `voucherview.aspx` (RFB / Licitaciones).
 * Es INDEPENDIENTE del módulo Compra Ágil (content.js): se auto-detecta y no hace nada
 * si la página actual no es un voucher con grilla de adjuntos.
 *
 * Flujo:
 *   1. Detecta la grilla de adjuntos (`table[id*="grdId"]`).
 *   2. Inyecta el botón "📥 Descargar todos los adjuntos".
 *   3. Recopila los campos ocultos del form (__VIEWSTATE, …) + las filas visibles.
 *   4. Envía cada archivo al background, el cual replica el POST "Ver Anexo" (captcha-free).
 *   5. Avanza página por página con reanudación vía sessionStorage (robusto ante postback
 *      completo = recarga de página, y ante postback parcial = UpdatePanel).
 *
 * Referencias del plan: plans/licitaciones-bulk-download-plan.md
 */
(function () {
    'use strict';

    // Guard anti-doble inyección: el módulo puede ser inyectado tanto por el
    // manifest (content_scripts) como programáticamente desde el background
    // (chrome.scripting). Si ya se cargó en este frame, no repetir (evita
    // observers y listeners duplicados). Se reinicia con cada nueva carga de documento.
    if (window.__mpVoucherContentLoaded) {
        try { console.log('[Voucher DBG] ya estaba cargado en este frame (skip).'); } catch (e) { }
        return;
    }
    window.__mpVoucherContentLoaded = true;

    // === BEACON (PRIMERA LÍNEA, INCONDICIONAL) ================================
    // Se ejecuta ANTES de cualquier chequeo de DOM. Si esta línea NO aparece en
    // la consola de una ventana/pestaña concreta, entonces el content script NO
    // está siendo inyectado ahí. También marca <html data-mp-voucher-cs> de inmediato
    // (legible por el inspector de consola en el mundo main).
    try {
        const __bFrame = (window.self === window.top) ? 'TOP' : 'IFRAME';
        console.log(`%c[Voucher DBG][${__bFrame}] BEACON — content script injected (first line)`, 'color:#c0392b;font-weight:bold;', location.href);
        document.documentElement.setAttribute('data-mp-voucher-cs', String(Date.now()));
    } catch (e) { /* noop */ }

    // Captura cualquier excepción no controlada dentro de este módulo y la muestra.
    window.addEventListener('error', function (ev) {
        try {
            console.error('[Voucher DBG] Uncaught error:', ev && ev.message,
                '@', (ev && ev.filename) + ':' + (ev && ev.lineno));
        } catch (_) { /* noop */ }
    });

    const LOG = '[Descarga Masiva Voucher]';
    const STATE_KEY = 'mp_voucher_bulk_state';

    // =========================================================================
    // Diagnóstico (mundo aislado de la extensión). Verboso ON para depurar
    // por qué el botón no aparece. Para silenciar desde la consola (mundo main):
    //   sessionStorage.setItem('mp_voucher_debug','0')   y luego recargar.
    // =========================================================================
    const DEBUG = (() => {
        try {
            const v = sessionStorage.getItem('mp_voucher_debug');
            return v === null ? true : v !== '0';
        } catch (e) { return true; }
    })();

    // Estado interno de diagnóstico (dedupe para no inundar la consola).
    let __bootDiagDone = false;
    let __lastInjectOutcome = null;
    let __lastGridCount = -1;

    function dbgFrame() {
        return (window.self === window.top) ? 'TOP' : 'IFRAME';
    }
    function dbg(tag, ...args) {
        if (!DEBUG) return;
        console.log(`%c[Voucher DBG][${dbgFrame()}] ${tag}`, 'color:#00549f;font-weight:bold;', ...args);
    }
    function dbgWarn(tag, ...args) {
        if (!DEBUG) return;
        console.warn(`[Voucher DBG][${dbgFrame()}] ${tag}`, ...args);
    }
    // Registra un resultado de injectVoucherButton SÓLO cuando cambia (anti-spam).
    function logInject(outcome, extra) {
        if (!DEBUG) return;
        if (outcome !== __lastInjectOutcome) {
            dbg('injectVoucherButton →', outcome, extra || '');
            __lastInjectOutcome = outcome;
        }
    }

    const CONFIG = {
        selectors: {
            grid: 'table[id*="grdId"]',
            verAnexoButton: 'input[type="image"][src*="ver"]',
            // Span del título "Anexos de la Oferta" (lleva el atributo idlbl="DWNLLblMessage")
            anexosLabel: 'span[idlbl="DWNLLblMessage"]',
            form: 'form#form1, form[name="form1"], form',
            paginationLink: 'a[href*="Page$"]'
        },
        ids: {
            voucherButton: 'mp-voucher-bulk-download'
        },
        texts: {
            voucherButtonInitial: '📥 Descargar todos los adjuntos',
            voucherButtonDownloading: '⏳ Descargando adjuntos...',
            voucherButtonDone: '✅ Completado',
            voucherButtonError: '❌ Error'
        },
        delays: {
            gridStableTimeout: 8000,
            gridSettleWindow: 600,
            betweenPages: 1500,
            betweenFiles: 500,   // debe coincidir con el rate-limit del background
            buttonReset: 3000
        },
        fallback: {
            gridUniqueID: 'UcVoucherView1$DWNL$grdId'
        }
    };

    // =========================================================================
    // Estado persistente (sessionStorage) — permite reanudar tras una recarga.
    // =========================================================================
    function readState() {
        try {
            const raw = sessionStorage.getItem(STATE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function saveState(state) {
        try {
            sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
        } catch (e) {
            /* sessionStorage puede fallar en contextos restringidos; seguimos igual */
        }
    }

    function clearState() {
        try {
            sessionStorage.removeItem(STATE_KEY);
        } catch (e) {
            /* noop */
        }
    }

    function isActive() {
        const s = readState();
        return !!(s && s.active);
    }

    // =========================================================================
    // Detección
    // =========================================================================
    function isVoucherPage() {
        // Detección puramente DOM: la grilla de adjuntos del voucher
        // (UcVoucherView1_DWNL_grdId) es exclusiva de esta página. No dependemos
        // del nombre del .aspx, que puede variar en popups/iframes y hacía fallar
        // la detección anterior basada en location.href.
        return document.querySelector(CONFIG.selectors.grid) !== null;
    }

    // Vuelca TODA la información relevante del entorno para diagnosticar por qué
    // el botón no aparece. Se invoca desde boot() y cuando la grilla aparece tarde.
    function diagnoseEnvironment(reason) {
        const where = dbgFrame();
        const tables = Array.from(document.querySelectorAll('table'));
        const tableIds = tables.map(t => t.id || t.name || '(sin id)');
        const grids = document.querySelectorAll(CONFIG.selectors.grid);
        const verAnexo = document.querySelectorAll(CONFIG.selectors.verAnexoButton);
        const pagination = document.querySelectorAll(CONFIG.selectors.paginationLink);
        const form = document.querySelector(CONFIG.selectors.form);
        const hiddenCount = form ? form.querySelectorAll('input[type="hidden"]').length : 0;
        const licCode = extractLicitacionCode();
        const enc = new URLSearchParams(location.search).get('enc');
        const bodyText = document.body ? document.body.innerText : '';
        const hasAnexosText = /anexos de la oferta/i.test(bodyText);

        const summary = {
            reason, where,
            href: location.href,
            readyState: document.readyState,
            enc: enc || '(ausente)',
            licCode: licCode || '(no hallado)',
            tableCount: tables.length,
            tableIds,
            gridSelectorMatches: grids.length,                 // table[id*="grdId"]
            gridIds: grids.length ? Array.from(grids).map(g => g.id) : [],
            verAnexoMatches: verAnexo.length,                  // input[type=image][src*=ver]
            paginationMatches: pagination.length,
            formFound: !!form,
            hiddenInputs: hiddenCount,
            anexosTextPresent: hasAnexosText,
            buttonAlreadyInjected: !!document.getElementById(CONFIG.ids.voucherButton)
        };

        console.groupCollapsed(`%c[Voucher DBG][${where}] diagnoseEnvironment — ${reason}`, 'color:#c0392b;font-weight:bold;');
        console.log(summary);
        console.groupEnd();
        return summary;
    }

    // =========================================================================
    // Utilidades de texto
    // =========================================================================
    function sanitizeVoucherFilename(name) {
        return (name || 'documento')
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
            .replace(/\s+/g, ' ')
            .trim() || 'documento';
    }

    function extractLicitacionCode() {
        const m = (document.body.innerText || '').match(/\b\d{3,}-\d+-L\d{2,}\b/);
        return m ? m[0] : 'Licitacion';
    }

    // Elige el nombre de archivo de una fila. Prioriza el span "..._File"
    // (columna "Anexo", p.ej. UcVoucherView1_DWNL_grdId_ctl02_File) que contiene
    // el nombre real del archivo; si no existe, usa el texto más significativo.
    function pickFilename(tr) {
        const fileSpan = tr.querySelector('span[id$="_File"]');
        if (fileSpan && fileSpan.textContent.trim()) {
            return sanitizeVoucherFilename(fileSpan.textContent.trim());
        }
        const lines = (tr.innerText || '')
            .split('\n')
            .map(s => s.trim())
            .filter(l => l && !/ver\s*anexo/i.test(l) && l.length > 1);
        if (lines.length === 0) {
            const all = (tr.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
            return sanitizeVoucherFilename(all[0] || 'documento');
        }
        const longest = lines.slice().sort((a, b) => b.length - a.length)[0];
        return sanitizeVoucherFilename(longest);
    }

    // =========================================================================
    // Recolección del DOM
    // =========================================================================
    function collectFormState() {
        const form = document.querySelector(CONFIG.selectors.form);
        if (!form) return null;
        const state = {};
        form.querySelectorAll('input[type="hidden"]').forEach(h => {
            if (h.name) state[h.name] = h.value;
        });
        return state; // { __VIEWSTATE, __VIEWSTATEGENERATOR, ... }
    }

    function collectPageFiles() {
        const grid = document.querySelector(CONFIG.selectors.grid);
        if (!grid) return [];
        const rows = Array.from(grid.querySelectorAll('tr'))
            .filter(tr => tr.querySelector(CONFIG.selectors.verAnexoButton));
        return rows.map(tr => {
            const btn = tr.querySelector(CONFIG.selectors.verAnexoButton);
            return {
                buttonName: btn.name, // UcVoucherView1$DWNL$grdId$ctlNN$search
                filename: pickFilename(tr)
            };
        });
    }

    function filesSignature(files) {
        return files.map(f => f.buttonName).sort().join('|');
    }

    // =========================================================================
    // Paginación
    // =========================================================================
    function getGridUniqueID() {
        const link = document.querySelector(CONFIG.selectors.paginationLink);
        if (link) {
            const m = (link.getAttribute('href') || '').match(/__doPostBack\('([^']+)'/);
            if (m) return m[1];
        }
        return CONFIG.fallback.gridUniqueID;
    }

    function getTotalPages() {
        const links = Array.from(document.querySelectorAll(CONFIG.selectors.paginationLink));
        const nums = links.map(a => {
            const m = (a.getAttribute('href') || '').match(/Page\$(\d+)/);
            return m ? parseInt(m[1], 10) : 0;
        });
        const current = getCurrentPageNumber();
        return Math.max(1, current, ...nums);
    }

    // Heurística: la página activa suele ser un <span> (no enlace) dentro del pager.
    function getCurrentPageNumber() {
        const grid = document.querySelector(CONFIG.selectors.grid);
        if (!grid) return 1;
        const rows = Array.from(grid.querySelectorAll('tr'));
        const pagerRow = rows[rows.length - 1];
        if (!pagerRow) return 1;

        const span = pagerRow.querySelector('span');
        if (span) {
            const n = parseInt((span.textContent || '').trim(), 10);
            if (!isNaN(n) && n > 0) return n;
        }
        const cells = Array.from(pagerRow.querySelectorAll('td, a, span'));
        for (const cell of cells) {
            const txt = (cell.textContent || '').trim();
            if (/^\d+$/.test(txt)) {
                const n = parseInt(txt, 10);
                if (n > 0) return n;
            }
        }
        return 1;
    }

    // Dispara la navegación a una página concreta ejecutando __doPostBack en el
    // mundo principal de la página (los content scripts no ven window.__doPostBack).
    function triggerPostBack(pageNum) {
        // 1) Click sobre el enlace del pager, si existe para esa página.
        const links = document.querySelectorAll(CONFIG.selectors.paginationLink);
        for (const a of links) {
            const m = (a.getAttribute('href') || '').match(/Page\$(\d+)/);
            if (m && parseInt(m[1], 10) === pageNum) {
                a.click();
                return true;
            }
        }
        // 2) Fallback: sintetiza un <a href="javascript:__doPostBack(...)"> y lo clicka.
        const gridID = getGridUniqueID();
        const a = document.createElement('a');
        a.setAttribute('href', `javascript:__doPostBack('${gridID}','Page$${pageNum}')`);
        document.body.appendChild(a);
        a.click();
        a.remove();
        return true;
    }

    // Espera a que la grilla tenga filas de datos.
    function waitForGridStable(timeout = CONFIG.delays.gridStableTimeout) {
        return new Promise(resolve => {
            const start = Date.now();
            (function check() {
                const grid = document.querySelector(CONFIG.selectors.grid);
                const hasRows = grid && Array.from(grid.querySelectorAll('tr'))
                    .some(tr => tr.querySelector(CONFIG.selectors.verAnexoButton));
                if (hasRows) return resolve(true);
                if (Date.now() - start > timeout) return resolve(false);
                setTimeout(check, 200);
            })();
        });
    }

    // Tras un __doPostBack parcial (UpdatePanel), espera la mutación y que se estabilice.
    function waitForNextGridUpdate(timeout = CONFIG.delays.gridStableTimeout) {
        return new Promise(resolve => {
            const grid = document.querySelector(CONFIG.selectors.grid);
            const root = (grid && grid.parentElement) ? grid.parentElement : document.body;
            let settleTimer = null;
            const obs = new MutationObserver(() => {
                if (settleTimer) clearTimeout(settleTimer);
                settleTimer = setTimeout(() => {
                    obs.disconnect();
                    resolve(true);
                }, CONFIG.delays.gridSettleWindow);
            });
            obs.observe(root, { childList: true, subtree: true });
            // Fallback si nunca hay mutación (p.ej. postback completo = recarga).
            setTimeout(() => { obs.disconnect(); resolve(false); }, timeout);
        });
    }

    function delay(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    // =========================================================================
    // UI
    // =========================================================================
    function setButtonState(state, text) {
        const b = document.getElementById(CONFIG.ids.voucherButton);
        if (!b) return;
        switch (state) {
            case 'downloading':
                b.disabled = true;
                b.textContent = text || CONFIG.texts.voucherButtonDownloading;
                b.style.opacity = '0.85';
                break;
            case 'done':
                b.textContent = CONFIG.texts.voucherButtonDone;
                b.style.opacity = '1';
                break;
            case 'error':
                b.textContent = CONFIG.texts.voucherButtonError;
                b.style.opacity = '1';
                break;
            default:
                b.disabled = false;
                b.textContent = CONFIG.texts.voucherButtonInitial;
                b.style.opacity = '1';
        }
    }

    function findAnexosLabel() {
        // Preferimos el span del título del voucher (atributo idlbl="DWNLLblMessage").
        let el = document.querySelector(CONFIG.selectors.anexosLabel);
        if (el && /anexos/i.test(el.textContent || '')) return el;
        // Fallback: buscar por texto "Anexos de la Oferta".
        const spans = Array.from(document.querySelectorAll('span'));
        return spans.find(s => /anexos de la oferta/i.test((s.textContent || '').trim())) || null;
    }

    function buildVoucherButton() {
        const button = document.createElement('button');
        button.id = CONFIG.ids.voucherButton;
        button.type = 'button';
        button.textContent = CONFIG.texts.voucherButtonInitial;
        Object.assign(button.style, {
            marginLeft: '15px',
            padding: '6px 14px',
            backgroundColor: '#00549f',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 'bold',
            display: 'inline-block',
            textAlign: 'center',
            verticalAlign: 'middle'
        });
        button.onmouseover = () => { if (!button.disabled) button.style.backgroundColor = '#0072ce'; };
        button.onmouseout = () => { if (!button.disabled) button.style.backgroundColor = '#00549f'; };
        button.addEventListener('click', (e) => {
            e.preventDefault();
            handleVoucherBulkDownload();
        });
        return button;
    }

    function buildVoucherHint() {
        const hint = document.createElement('span');
        hint.textContent = 'Descarga cada archivo (sin captcha) en Licitacion_<código>/';
        Object.assign(hint.style, {
            marginLeft: '10px', fontSize: '11px', color: '#666', verticalAlign: 'middle'
        });
        return hint;
    }

    function injectVoucherButton() {
        if (!isVoucherPage()) {
            logInject('SKIP — no es página voucher (grilla no encontrada). Revisa el dump de tables/gridIds.');
            return null;
        }
        if (document.getElementById(CONFIG.ids.voucherButton)) {
            logInject('OK — botón ya presente (no-op).');
            return document.getElementById(CONFIG.ids.voucherButton);
        }
        const grid = document.querySelector(CONFIG.selectors.grid);
        if (!grid) {
            logInject('ERROR — isVoucherPage true pero grid null (condición incoherente).');
            return null;
        }

        const button = buildVoucherButton();
        const hint = buildVoucherHint();

        // Lugar preferido: la MISMA FILA del título "Anexos de la Oferta".
        const label = findAnexosLabel();
        if (label) {
            // hint primero (queda después del label), luego button antes del hint:
            //  [Anexos de la Oferta] [📥 Descargar todos los adjuntos] [hint]
            label.insertAdjacentElement('afterend', hint);
            label.insertAdjacentElement('afterend', button);
            logInject('INJECT — tras el label "Anexos de la Oferta".', `parent=${label.tagName}`);
            return button;
        }

        // Fallback: justo encima de la grilla si no se halló el título.
        const wrap = document.createElement('div');
        Object.assign(wrap.style, {
            margin: '8px 0', display: 'flex', alignItems: 'center',
            gap: '10px', flexWrap: 'wrap'
        });
        wrap.appendChild(button);
        wrap.appendChild(hint);
        (grid.parentElement || grid.parentNode).insertBefore(wrap, grid);
        logInject('INJECT — fallback (wrap antes de la grilla).', `grid.id=${grid.id}`);
        return button;
    }

    function showCompletionModal(totalDownloaded) {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: '99999',
            display: 'flex', justifyContent: 'center', alignItems: 'center'
        });

        const modal = document.createElement('div');
        Object.assign(modal.style, {
            backgroundColor: '#fff', padding: '30px', borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', textAlign: 'center', maxWidth: '420px',
            fontFamily: '"Roboto","Helvetica","Arial",sans-serif'
        });

        const icon = document.createElement('div');
        icon.textContent = '✅';
        icon.style.fontSize = '48px';
        icon.style.marginBottom = '10px';

        const title = document.createElement('h2');
        title.textContent = '¡Descargas Finalizadas!';
        title.style.margin = '0 0 10px';
        title.style.color = '#333';

        const text = document.createElement('p');
        text.textContent = `Se descargaron ${totalDownloaded} archivo(s) correctamente en la subcarpeta "Licitacion_..." dentro de tu carpeta de Descargas.`;
        text.style.color = '#666';
        text.style.lineHeight = '1.5';
        text.style.marginBottom = '20px';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Aceptar';
        Object.assign(closeBtn.style, {
            padding: '10px 24px', backgroundColor: '#00549f', color: '#fff', border: 'none',
            borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold'
        });

        const close = () => { if (document.body.contains(overlay)) overlay.remove(); };
        closeBtn.onclick = close;

        modal.appendChild(icon);
        modal.appendChild(title);
        modal.appendChild(text);
        modal.appendChild(closeBtn);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        setTimeout(close, 10000);
    }

    // =========================================================================
    // Orquestación
    // =========================================================================
    async function handleVoucherBulkDownload() {
        if (isActive()) {
            console.log(LOG, 'Ya hay una descarga masiva en curso.');
            return;
        }

        const enc = new URLSearchParams(location.search).get('enc');
        if (!enc) {
            alert('No se pudo leer el parámetro "enc" de la URL del voucher.');
            return;
        }

        const totalPages = getTotalPages();
        const currentPage = getCurrentPageNumber();
        const rootFolder = `Licitacion_${extractLicitacionCode()}`;

        saveState({
            version: 1,
            active: true,
            currentPage,
            totalPages,
            totalDownloaded: 0,
            processedPages: [],
            lastSignature: null,
            rootFolder,
            enc,
            pageUrl: location.href.split('#')[0]
        });

        console.log(LOG, `Inicio: página ${currentPage}/${totalPages}, carpeta "${rootFolder}".`);
        setButtonState('downloading', `⏳ Página ${currentPage}/${totalPages}...`);

        try {
            await runCurrentPage();
            await advanceOrFinish();
        } catch (err) {
            console.error(LOG, 'Error en descarga masiva:', err);
            setButtonState('error');
            clearState();
            setTimeout(() => setButtonState('initial'), CONFIG.delays.buttonReset);
        }
    }

    async function runCurrentPage() {
        await waitForGridStable();
        const state = readState();
        if (!state || !state.active) return;

        if (state.processedPages.includes(state.currentPage)) {
            console.warn(LOG, `Página ${state.currentPage} ya procesada, se omite.`);
            return;
        }

        const formState = collectFormState();
        if (!formState) {
            console.warn(LOG, 'No se encontró el form ni __VIEWSTATE.');
            return;
        }

        const files = collectPageFiles();
        if (files.length === 0) {
            state.processedPages.push(state.currentPage);
            saveState(state);
            return;
        }

        // Anti-duplicados: si la grilla no varió respecto a la página previa,
        // asumimos que la paginación se agotó (o el postback no navegó).
        const sig = filesSignature(files);
        if (state.lastSignature && sig === state.lastSignature) {
            console.warn(LOG, 'La grilla no varió tras el postback; se asige fin de paginación.');
            return finishDownload(state);
        }
        state.lastSignature = sig;
        saveState(state);

        setButtonState('downloading', `⏳ Página ${state.currentPage}/${state.totalPages} · ${files.length} archivo(s)`);

        let resp;
        try {
            resp = await chrome.runtime.sendMessage({
                action: 'downloadVoucherFiles',
                formState,
                enc: state.enc,
                files,
                rootFolder: state.rootFolder,
                pageUrl: state.pageUrl
            });
        } catch (err) {
            console.error(LOG, 'Fallo de comunicación con el background:', err);
            resp = { downloaded: 0 };
        }

        state.totalDownloaded += (resp && typeof resp.downloaded === 'number') ? resp.downloaded : 0;
        state.processedPages.push(state.currentPage);
        saveState(state);
    }

    async function advanceOrFinish() {
        const state = readState();
        if (!state || !state.active) return;

        if (state.currentPage < state.totalPages) {
            state.currentPage += 1;
            saveState(state);
            setButtonState('downloading', `⏳ Página ${state.currentPage}/${state.totalPages}...`);

            triggerPostBack(state.currentPage);
            await waitForNextGridUpdate();   // postback parcial: contexto vivo
            await delay(CONFIG.delays.betweenPages);
            // Si fue un postback completo (recarga), este contexto muere aquí y la
            // nueva inyección reanuda vía maybeResume(). No hay doble procesamiento.
            await runCurrentPage();
            await advanceOrFinish();
        } else {
            finishDownload(state);
        }
    }

    function finishDownload(state) {
        const total = state ? state.totalDownloaded : 0;
        clearState();
        setButtonState('done');
        console.log(LOG, `Completado. Total descargado: ${total} archivo(s).`);
        showCompletionModal(total);
        setTimeout(() => setButtonState('initial'), CONFIG.delays.buttonReset);
    }

    // Reanudación tras postback completo (la página se recargó y el script se reinyectó).
    async function maybeResume() {
        const state = readState();
        if (!state || !state.active) return;
        // Sólo reanudar dentro del mismo voucher (mismo path, sin considerar query/hash).
        if (state.pageUrl.split('?')[0] !== location.href.split('?')[0]) {
            clearState();
            return;
        }

        console.log(LOG, `Reanudando en página ${state.currentPage}/${state.totalPages}...`);
        setButtonState('downloading', `⏳ Reanudando página ${state.currentPage}/${state.totalPages}...`);
        try {
            await waitForGridStable();
            await runCurrentPage();
            await advanceOrFinish();
        } catch (err) {
            console.error(LOG, 'Error al reanudar:', err);
            setButtonState('error');
            clearState();
            setTimeout(() => setButtonState('initial'), CONFIG.delays.buttonReset);
        }
    }

    // =========================================================================
    // Progreso por archivo (mensajes del background)
    // =========================================================================
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'downloadVoucherProgress') {
            const state = readState();
            const page = state ? state.currentPage : '?';
            const total = request.total || 0;
            setButtonState('downloading', `⏳ Página ${page} · archivo ${request.current}/${total}...`);
        }
        // No retornamos true: es síncrono, no bloquea a otros listeners.
    });

    // =========================================================================
    // Init
    // =========================================================================
    function boot() {
        if (!__bootDiagDone) {
            __bootDiagDone = true;
            dbg('boot — ejecutando.', `readyState=${document.readyState}`);
            diagnoseEnvironment('boot');
        }
        if (!isVoucherPage()) {
            dbgWarn('boot — NO se detecta como página voucher; no se inyecta botón.',
                'Si crees que sí lo es, compara los tableIds/gridIds del dump de arriba con el selector table[id*="grdId"].');
            return;
        }
        injectVoucherButton();
        maybeResume(); // asíncrono, sin await
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    // Mantiene el botón presente ante postbacks parciales (UpdatePanel) que re-renderizan.
    // Además, detecta si la grilla aparece tarde (carga AJAX tras document_end) y
    // vuelve a volcar el diagnóstico cuando eso ocurre.
    const keepAlive = new MutationObserver(() => {
        const gridNow = document.querySelectorAll(CONFIG.selectors.grid).length;
        if (gridNow !== __lastGridCount) {
            dbg('keepAlive — cambió el # de grillas:', `${__lastGridCount} → ${gridNow}`);
            __lastGridCount = gridNow;
            if (gridNow > 0) diagnoseEnvironment('keepAlive (la grilla apareció tarde)');
        }
        if (isVoucherPage()) injectVoucherButton();
    });
    if (document.body) {
        keepAlive.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            keepAlive.observe(document.body, { childList: true, subtree: true });
        });
    }

    // Marca legible desde el mundo main (inspector de consola) para confirmar que
    // este content script SÍ se inyectó, aunque el botón no llegue a aparecer.
    try { document.documentElement.setAttribute('data-mp-voucher-cs', String(Date.now())); } catch (e) { }

    dbg('Módulo cargado (content script injected).', {
        href: location.href,
        frame: dbgFrame(),
        readyState: document.readyState,
        debug: DEBUG
    });
})();
