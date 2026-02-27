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

async function handleAllOffersDownload(ofertas, token, rootFolder = 'MercadoPublico_Ofertas') {
    let totalDownloaded = 0;

    for (const oferta of ofertas) {
        const providerName = sanitizeFilename(oferta.razonSocial || oferta.nombre || `Proveedor_${oferta.id}`);
        console.log(`[Descarga Masiva] Fetching attachments for: ${providerName}...`);

        const attachs = await fetchOfferDetails(oferta.id, token);

        for (const file of attachs) {
            try {
                const base64Data = await downloadFileAsBase64(file.id, token);
                const safeFileName = sanitizeFilename(file.filename);
                // The filename property will dictate the relative path inside the user's Downloads folder
                // e.g. "2284-145-COT26/ProveedorName/filename.pdf"
                const relativePath = `${rootFolder}/${providerName}/${safeFileName}`;

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
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'downloadAllOffers') {
        console.log('[Descarga Masiva] Iniciando descarga masiva...', request.ofertas.length, 'ofertas');

        // Ejecutar proceso asíncrono
        handleAllOffersDownload(request.ofertas, request.token, request.rootFolder)
            .then(() => sendResponse({ success: true }))
            .catch((err) => {
                console.error(err);
                sendResponse({ success: false, error: err.message });
            });

        // Return true indicates we wish to send a response asynchronously
        return true;
    }
});
