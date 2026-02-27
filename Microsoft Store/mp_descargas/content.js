// Inyecta el interceptor y agrega un botón para descargar todos los adjuntos de una cotización
(function () {
    'use strict';

    // Detección de navegador para logging y optimizaciones específicas
    const isEdge = navigator.userAgent.includes('Edg');
    const isChrome = navigator.userAgent.includes('Chrome') && !isEdge;

    console.log(`[MP Descargas] Ejecutando en: ${isEdge ? 'Edge' : isChrome ? 'Chrome' : 'Otro navegador'}`);

    const CONFIG = {
        api: {
            downloadUrlBase: 'https://servicios-compra-agil.mercadopublico.cl/v1/compra-agil/proveedor/cotizacion/descargarAdjunto/'
        },
        selectors: {
            attachmentTitle: 'p',
            callingPhaseLabel: 'span', // To find "Primer Llamado" or "Segundo Llamado"
        },
        texts: {
            attachmentTitleText: 'Adjuntos de la cotización',
            callingPhaseText: 'Llamado',
            buttonInitial: '📥 Descargar todo',
            buttonDownloading: '⏳ Descargando...',
            buttonDone: '✅ Completado',
            buttonBulkInitial: '📥 Descargar todas las ofertas',
            buttonBulkDownloading: '⏳ Descargando todas las ofertas...',
            buttonError: '❌ Error',
        },
        ids: {
            downloadButton: 'mp-bulk-download-ultimate',
            downloadAllButton: 'mp-download-all-offers'
        },
        delays: {
            downloadInterval: 1000
        }
    };

    let interceptedData = null;
    let allOffersData = null;

    function injectApiInterceptor() {
        if (document.getElementById('mp-api-interceptor-script')) return;
        const script = document.createElement('script');
        script.id = 'mp-api-interceptor-script';

        // Optimizado para Chrome/Edge - ambos usan chrome.* APIs
        script.src = chrome.runtime.getURL('api_interceptor.js');

        (document.head || document.documentElement).appendChild(script);
        script.onload = () => { script.remove(); };
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function authenticatedDownload(url, filename, authToken) {
        try {
            const response = await fetch(url, { headers: { 'Authorization': authToken } });
            if (!response.ok) throw new Error(`Fallo en la petición: ${response.status} ${response.statusText}`);
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(blobUrl);
            a.remove();
        } catch (error) {
            console.error(`[Descarga Masiva] Falló la descarga de ${filename}:`, error);
        }
    }

    async function handleBulkDownload() {
        if (!interceptedData || !interceptedData.files || !interceptedData.token) return;
        const { files, token } = interceptedData;
        const button = document.getElementById(CONFIG.ids.downloadButton);
        button.textContent = CONFIG.texts.buttonDownloading;
        button.disabled = true;

        for (const file of files) {
            const downloadUrl = `${CONFIG.api.downloadUrlBase}${file.id}`;
            await authenticatedDownload(downloadUrl, file.filename, token);
            await delay(CONFIG.delays.downloadInterval);
        }

        button.textContent = CONFIG.texts.buttonDone;
        setTimeout(() => {
            button.textContent = CONFIG.texts.buttonInitial;
            button.disabled = false;
        }, 2000);
    }

    function showCompletionModal() {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
            backgroundColor: 'rgba(0,0,0,0.5)', zIndex: '9999',
            display: 'flex', justifyContent: 'center', alignItems: 'center'
        });

        const modal = document.createElement('div');
        Object.assign(modal.style, {
            backgroundColor: 'white', padding: '30px', borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', textAlign: 'center',
            maxWidth: '400px', fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif'
        });

        const icon = document.createElement('div');
        icon.innerHTML = '✅';
        icon.style.fontSize = '48px';
        icon.style.marginBottom = '10px';

        const title = document.createElement('h2');
        title.textContent = '¡Descargas Finalizadas!';
        title.style.margin = '0 0 10px';
        title.style.color = '#333';

        const text = document.createElement('p');
        text.textContent = 'Revisa tu carpeta de "Descargas" local para encontrar las ofertas organizadas en sus respectivas subcarpetas.';
        text.style.color = '#666';
        text.style.lineHeight = '1.5';
        text.style.marginBottom = '20px';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Aceptar';
        Object.assign(closeBtn.style, {
            padding: '10px 24px', backgroundColor: '#00549f', color: 'white',
            border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px',
            fontWeight: 'bold'
        });

        const closeModal = () => { if (document.body.contains(overlay)) document.body.removeChild(overlay); };
        closeBtn.onclick = closeModal;

        modal.appendChild(icon);
        modal.appendChild(title);
        modal.appendChild(text);
        modal.appendChild(closeBtn);
        overlay.appendChild(modal);

        document.body.appendChild(overlay);

        // Auto Close in 10 secs
        setTimeout(closeModal, 10000);
    }

    function extractQuotationCode() {
        const titleEl = document.querySelector('h2');
        if (!titleEl) return null;
        // Match pattern like 2284-145-COT26
        const match = titleEl.textContent.match(/\d+-\d+-[A-Z0-9]+/);
        return match ? match[0] : null;
    }

    function sanitizeFolderName(name) {
        if (!name) return 'MercadoPublico_Ofertas';
        return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
    }

    function handleDownloadAllOffers() {
        if (!allOffersData || !allOffersData.ofertas || !allOffersData.token) return;

        const button = document.getElementById(CONFIG.ids.downloadAllButton);
        const quotaCode = extractQuotationCode();
        const rootFolder = sanitizeFolderName(quotaCode);

        // --- NUEVA LÓGICA DE FILTRADO ---
        // Solo descargar ofertas que NO estén marcadas como INADMISIBLE
        const filteredOfertas = allOffersData.ofertas.filter(oferta => {
            const providerName = oferta.razonSocial || oferta.nombre;
            // Buscamos la tarjeta en el DOM que contenga el nombre del proveedor
            const cards = Array.from(document.querySelectorAll('.MuiPaper-root'));
            const matchingCard = cards.find(card => card.textContent.includes(providerName));

            if (matchingCard) {
                const isRejected = Array.from(matchingCard.querySelectorAll('span, div')).some(el => {
                    return el && el.textContent && el.textContent.trim() === 'INADMISIBLE';
                });
                if (isRejected) {
                    console.log(`[Descarga Masiva] Saltando oferta de ${providerName} (Marcada como INADMISIBLE)`);
                    return false;
                }
            }
            return true;
        });

        if (filteredOfertas.length === 0) {
            alert("No hay ofertas válidas (no inadmisibles) para descargar.");
            return;
        }

        button.textContent = CONFIG.texts.buttonBulkDownloading;
        button.disabled = true;

        // Send a message to the background script to handle the massive download
        chrome.runtime.sendMessage({
            action: 'downloadAllOffers',
            ofertas: filteredOfertas,
            token: allOffersData.token,
            rootFolder: rootFolder
        }, (response) => {
            // Reset UI after completion/failure reported by background
            button.textContent = CONFIG.texts.buttonDone;

            if (response && response.success) {
                showCompletionModal();
            }

            setTimeout(() => {
                button.textContent = CONFIG.texts.buttonBulkInitial;
                button.disabled = false;
            }, 3000);
        });
    }

    function injectDownloadAllButton() {
        if (document.getElementById(CONFIG.ids.downloadAllButton)) return;

        // Look for "Primer Llamado" or "Segundo Llamado" span
        const callingPhaseElements = Array.from(document.querySelectorAll(CONFIG.selectors.callingPhaseLabel));
        const targetSpan = callingPhaseElements.find(el => el.textContent.includes(CONFIG.texts.callingPhaseText));

        if (!targetSpan) return;

        // The parent of the label wrapper
        const injectionWrapper = targetSpan.parentElement;
        if (!injectionWrapper) return;

        const button = document.createElement('button');
        button.id = CONFIG.ids.downloadAllButton;
        button.textContent = CONFIG.texts.buttonBulkInitial;
        Object.assign(button.style, {
            marginLeft: '15px',
            padding: '6px 12px',
            backgroundColor: '#00549f',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 'normal',
            display: 'inline-block',
            textAlign: 'center',
            verticalAlign: 'middle'
        });
        button.onclick = handleDownloadAllOffers;

        // Inyectamos el botón después del contenedor del texto (al lado, no dentro)
        injectionWrapper.insertAdjacentElement('afterend', button);
    }

    injectApiInterceptor();
    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || !event.data.type) return;

        if (event.data.type === 'MP_DATA_FROM_PAGE') {
            interceptedData = event.data.payload;
            setTimeout(injectDownloadButton, 500);
        } else if (event.data.type === 'MP_ALL_OFFERS_FROM_PAGE') {
            allOffersData = event.data.payload;
            setTimeout(injectDownloadAllButton, 500);
        }
    });
})();