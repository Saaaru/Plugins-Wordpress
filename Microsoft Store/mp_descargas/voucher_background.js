/**
 * voucher_background.js — Descarga de adjuntos para LICITACIONES (Voucher View).
 *
 * Replica el POST "Ver Anexo" (captcha-free) desde el service worker:
 *   - Reconstruye el body application/x-www-form-urlencoded con TODOS los campos
 *     ocultos del form (__VIEWSTATE, __VIEWSTATEGENERATOR, …) + las coordenadas
 *     del botón de fila (`<buttonName>.x=1&<buttonName>.y=1`).
 *   - Las cookies viajan automáticamente (host_permissions concedidos + credentials: include).
 *   - Convierte el blob a base64 y lo guarda con chrome.downloads.download bajo
 *     `Licitacion_<CODE>/<filename>`.
 *
 * Es un ES module importado por background.js (que declara "type": "module").
 * No interfiere con el handler de Compra Ágil (acción distinta: 'downloadVoucherFiles').
 */

function sanitizeFilename(name) {
    if (!name) return 'Desconocido';
    return name
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+/, '')   // Windows rejects folder names starting with "."
        .replace(/\.+$/, '')   // or ending with "."
        || 'Desconocido';
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// POST que reproduce el clic en "Ver Anexo" de una fila concreta.
async function downloadVoucherFile(formState, enc, buttonName, filename, rootFolder) {
    const params = new URLSearchParams();
    // Evita claves duplicadas: formState ya trae __EVENTTARGET/__EVENTARGUMENT vacíos.
    const state = { ...formState };
    delete state.__EVENTTARGET;
    delete state.__EVENTARGUMENT;
    for (const [key, value] of Object.entries(state)) {
        params.append(key, value);
    }
    params.append('__EVENTTARGET', '');
    params.append('__EVENTARGUMENT', '');
    params.append(`${buttonName}.x`, '1');
    params.append(`${buttonName}.y`, '1');

    const url = `https://www.mercadopublico.cl/bid/modules/bid/voucherview.aspx?enc=${encodeURIComponent(enc)}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        credentials: 'include' // cookies de sesión viajan automáticamente
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    // Guarda: si el servidor devuelve HTML/JSON/texto (página de error o login), NO es un archivo.
    const contentType = response.headers.get('content-type') || '';
    if (/html|json|text\/plain|text\/html/i.test(contentType)) {
        console.warn('[Voucher] Respuesta no binaria (se omite):', filename, '|', contentType);
        return false;
    }

    const blob = await response.blob();
    console.log(`[Voucher] ${filename} — contentType: "${contentType}" | blob size: ${blob.size} bytes`);
    if (!blob || blob.size === 0) {
        console.warn('[Voucher] Blob vacío (se omite):', filename);
        return false;
    }

    const base64 = await blobToBase64(blob);
    const safeName = sanitizeFilename(filename);
    const relativePath = `${rootFolder}/${safeName}`;

    const downloadId = await new Promise((resolve) => {
        chrome.downloads.download({
            url: base64,
            filename: relativePath,
            conflictAction: 'uniquify',
            saveAs: false
        }, (id) => {
            if (chrome.runtime.lastError) {
                console.error('[Voucher] chrome.downloads.download ERROR:', chrome.runtime.lastError.message, '| path:', relativePath);
                resolve(null);
            } else {
                resolve(id);
            }
        });
    });

    if (downloadId === null) {
        console.error('[Voucher] Descarga FALLIDA:', relativePath);
        return false;
    }

    console.log('[Voucher] Descargado (id:' + downloadId + '):', relativePath);
    return true;
}

// Procesa todos los archivos de una página y reporta progreso a la pestaña origen.
async function handleVoucherDownload(request, sender) {
    const { formState, enc, files, rootFolder } = request;
    console.log('[Voucher] handleVoucherDownload — files:', files.length, '| rootFolder:', rootFolder, '| formState keys:', Object.keys(formState).join(','));
    let downloaded = 0;

    for (let i = 0; i < files.length; i++) {
        // Progreso por archivo al content script emisor (respeta el frame correcto).
        if (sender && sender.tab && sender.tab.id) {
            const opts = (sender.frameId != null) ? { frameId: sender.frameId } : undefined;
            chrome.tabs.sendMessage(sender.tab.id, {
                action: 'downloadVoucherProgress',
                current: i + 1,
                total: files.length,
                downloaded
            }, opts).catch(() => { /* la pestaña pudo cerrarse */ });
        }

        try {
            const ok = await downloadVoucherFile(
                formState, enc, files[i].buttonName, files[i].filename, rootFolder
            );
            if (ok) downloaded++;
        } catch (err) {
            console.error('[Voucher] Falló:', files[i].filename, err);
        }

        // Rate-limit para evitar bloqueos del servidor.
        await new Promise((r) => setTimeout(r, 500));
    }

    console.log(`[Voucher] Página completada: ${downloaded}/${files.length} archivos.`);
    return { success: true, downloaded };
}

// Registro del listener. Lo invoca background.js al cargar.
export function initVoucherHandler() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'downloadVoucherFiles') {
            handleVoucherDownload(request, sender)
                .then((result) => sendResponse(result))
                .catch((err) => {
                    console.error('[Voucher] Error general:', err);
                    sendResponse({ success: false, error: err.message, downloaded: 0 });
                });
            return true; // respuesta asíncrona
        }
        // Para otras acciones, no retornamos true: las manejan otros listeners.
    });
    console.log('[Voucher] Handler de descarga masiva registrado (downloadVoucherFiles).');
}
