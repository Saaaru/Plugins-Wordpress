import { initVoucherHandler } from './voucher_background.js';

const CONFIG = {
    api: {
        offerDetailsUrl: 'https://servicios-compra-agil.mercadopublico.cl/v1/compra-agil/solicitud/cotizacion/',
        downloadUrlBase: 'https://servicios-compra-agil.mercadopublico.cl/v1/compra-agil/proveedor/cotizacion/descargarAdjunto/'
    }
};

// Utilities to clean folder names (avoid invalid characters)
function sanitizeFilename(name) {
    if (!name) return 'Desconocido';
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}

async function fetchOfferDetails(ofertaId, token) {
    try {
        const response = await fetch(`${CONFIG.api.offerDetailsUrl}${ofertaId}`, {
            headers: { 'Authorization': token }
        });
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const data = await response.json();
        return data?.payload?.documentosAdjuntos || [];
    } catch (e) {
        console.error(`[Descarga Masiva] Error fetching details for offer ${ofertaId}:`, e);
        return [];
    }
}

async function downloadFileAsBase64(fileId, token) {
    const response = await fetch(`${CONFIG.api.downloadUrlBase}${fileId}`, {
        headers: { 'Authorization': token }
    });

    if (!response.ok) {
        throw new Error(`Failed to download ${fileId}`);
    }

    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function handleAllOffersDownload(ofertas, token, rootFolder = 'MercadoPublico_Ofertas', sender) {
    let totalDownloaded = 0;
    const totalOffers = ofertas.length;

    for (let i = 0; i < ofertas.length; i++) {
        const oferta = ofertas[i];
        const providerName = sanitizeFilename(oferta.razonSocial || oferta.nombre || `Proveedor_${oferta.id}`);
        console.log(`[Descarga Masiva] Fetching attachments for: ${providerName}...`);

        // Reportar progreso al content script de la pestaña emisora
        if (sender && sender.tab && sender.tab.id) {
            chrome.tabs.sendMessage(sender.tab.id, {
                action: 'downloadProgress',
                currentOffer: i + 1,
                totalOffers: totalOffers,
                filesDownloaded: totalDownloaded
            }).catch(() => { /* La pestaña pudo haberse cerrado; ignorar */ });
        }

        const attachs = await fetchOfferDetails(oferta.id, token);

        for (const file of attachs) {
            try {
                const base64Data = await downloadFileAsBase64(file.id, token);
                const safeFileName = sanitizeFilename(file.filename);
                // The filename property will dictate the relative path inside the user's Downloads folder
                // e.g. "2284-145-COT26/1.- ProveedorName/filename.pdf"
                // El prefijo numerado (i+1) preserva el orden en que aparecen las ofertas en la tabla del portal.
                const folderNumber = i + 1;
                const relativePath = `${rootFolder}/${folderNumber}.- ${providerName}/${safeFileName}`;

                await new Promise((resolve) => {
                    chrome.downloads.download({
                        url: base64Data,
                        filename: relativePath,
                        conflictAction: 'uniquify'
                    }, (downloadId) => {
                        resolve(downloadId);
                    });
                });

                totalDownloaded++;

                // Add a small delay to prevent rate-limiting or browser lockup
                await new Promise(r => setTimeout(r, 500));
            } catch (err) {
                console.error(`[Descarga Masiva] Failed to process file ${file.filename} for ${providerName}:`, err);
            }
        }
    }

    console.log(`[Descarga Masiva] Finalizado. Se descargaron ${totalDownloaded} archivos.`);
    return totalDownloaded;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'downloadAllOffers') {
        console.log('[Descarga Masiva] Iniciando descarga masiva...', request.ofertas.length, 'ofertas');

        // Ejecutar proceso asíncrono
        handleAllOffersDownload(request.ofertas, request.token, request.rootFolder, sender)
            .then((totalDownloaded) => sendResponse({ success: true, totalDownloaded }))
            .catch((err) => {
                console.error(err);
                sendResponse({ success: false, error: err.message });
            });

        // Return true indicates we wish to send a response asynchronously
        return true;
    }
});

// Módulo Licitaciones (Voucher View): registra su propio listener para 'downloadVoucherFiles'.
initVoucherHandler();

// =========================================================================
// Inyección PROGRAMÁTICA del módulo voucher en ventanas/popups de voucherview.aspx.
// Respaldo necesario: en Edge/Chrome MV3, los content_scripts del manifest a veces
// NO se inyectan en popups abiertos con window.open, aunque la URL coincida con el
// match. Esto garantiza la inyección y, si falla, deja el error exacto en el log
// del Service Worker (chrome://extensions → "Service worker" → Inspect).
// =========================================================================
const VOUCHER_URL_RE = /\/bid\/modules\/bid\/voucherview\.aspx(\?|$)/i;

// Inyecta el módulo voucher en el frame principal de la pestaña/ventana indicada.
// Reintenta una vez tras pausa para descartar que sea una condición transitoria
// (popup redirigiéndose / documento recargándose).
function injectVoucher(tabId, url, attempt) {
    chrome.scripting.executeScript({
        target: { tabId },
        files: ['voucher_content.js']
    }).then(() => {
        console.log(`[Voucher BG] Inyección OK en tab ${tabId} (top frame${attempt > 1 ? `, intento ${attempt}` : ''}). url=${url}`);
    }).catch((err) => {
        console.warn(`[Voucher BG] Inyección falló (tab ${tabId}, intento ${attempt}). url=${url} →`, err && err.message);
        if (attempt < 2) {
            setTimeout(() => injectVoucher(tabId, url, attempt + 1), 1500);
        } else {
            console.error(
                `[Voucher BG] Inyección BLOQUEADA de forma definitiva en tab ${tabId}. url=${url}\n` +
                'Posibles causas y acciones:\n' +
                ' • La ventana emergente es STALE (abierta antes de recargar la extensión): ciérrala, recarga la extensión y vuelve a abrirla.\n' +
                ' • Edge no concede acceso al sitio: en la ventana emergente pulsa el icono de MP Tools → "Permitir en este sitio".\n' +
                ' • Si persiste, Edge bloquea la inyección en popups de este sitio y habrá que migrar la descarga a la página principal.'
            );
        }
    });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    const url = (tab && tab.url) ? tab.url : '';
    if (!VOUCHER_URL_RE.test(url)) return;

    console.log(`[Voucher BG] onUpdated(complete) tab ${tabId} window ${tab && tab.windowId} incognito=${tab && tab.incognito}. url=${url}`);
    injectVoucher(tabId, url, 1);
});

console.log('[Voucher BG] Listener de inyección programática registrado (tabs.onUpdated).');
