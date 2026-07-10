import { initVoucherHandler } from './voucher_background.js';

// Reporte de escaneo del módulo de descarga de Licitaciones (licitaciones_download.js):
// cada frame reporta periódicamente dónde corre y cuántos botones/grilla ve. Así vemos
// desde un solo lugar (Service Worker) en qué frames se inyecta el content script y si
// alguno contiene la grilla grdSupplies de Licitaciones.
chrome.runtime.onMessage.addListener((request, sender) => {
    if (request.action === 'licitacionesScanReport' || request.action === 'licitacionesBootReport') {
        const tab = (sender && sender.tab && sender.tab.id) || '?';
        const frameId = (sender && sender.frameId != null) ? sender.frameId : 'top';
        const url = request.url || request.frame || '';
        const comp = request.comprobante != null ? request.comprobante : (request.found != null ? request.found : '?');
        const grids = request.grids != null ? request.grids : '?';
        const top = request.isTop ? 'TOP' : 'iframe';
        console.log(`[Licitaciones DL] scan — tab ${tab} frameId ${frameId} (${top}) | ${url} | comprobante:${comp} grdSupplies:${grids}`);
    }
});

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

// NOTA: La inyección programática en el popup del voucher se ELIMINÓ. Se confirmó
// que Edge bloquea la inyección en la ventana emergente chromeless. La descarga
// masiva de Licitaciones se realiza desde la PÁGINA PRINCIPAL mediante
// licitaciones_download.js (content script del manifest: obtiene el voucher por
// `enc` con fetch y reutiliza el handler 'downloadVoucherFiles').
// El permiso `scripting` y la inyección programática en www.mercadopublico.cl se
// quitaron porque Edge los bloquea ("Blocked") y además dejaban la extensión en
// estado "permisos pendientes" que inutilizaba el toggle por sitio.
console.log('[Voucher BG] Handler activo (downloadVoucherFiles). Sin inyección programática.');
