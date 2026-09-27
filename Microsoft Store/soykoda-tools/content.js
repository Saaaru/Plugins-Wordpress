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

    function extractQuotationCode() {
        const titleEl = document.querySelector('h2');
        if (!titleEl) return null;
        // Match pattern like 2284-145-COT26
        const match = titleEl.textContent.match(/\d+-\d+-[A-Z0-9]+/);
        return match ? match[0] : null;
    }

    function sanitizeFolderName(name) {
        if (!name) return 'MercadoPublico_Ofertas';
        let clean = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
        return clean || 'MercadoPublico_Ofertas';
    }

    function getFieldValueByLabel(labelText) {
        const cleanLabel = labelText.trim().toLowerCase();
        const elements = Array.from(document.querySelectorAll('p, span, dt, label'));
        const targetLabel = elements.find(el => el.textContent.trim().toLowerCase() === cleanLabel);

        if (targetLabel) {
            // Estrategia 1: Siguiente hermano en el grid MuiGrid-item
            const gridItem = targetLabel.closest('.MuiGrid-item');
            if (gridItem && gridItem.nextElementSibling) {
                const valP = gridItem.nextElementSibling.querySelector('p');
                if (valP && valP.textContent.trim()) {
                    return valP.textContent.trim();
                }
                const valText = gridItem.nextElementSibling.textContent.trim();
                if (valText) return valText;
            }

            // Estrategia 2: Contenedor de fila MuiGrid-container
            const container = targetLabel.closest('.MuiGrid-container');
            if (container) {
                const allP = Array.from(container.querySelectorAll('p'));
                const valueP = allP.find(p => p !== targetLabel && p.textContent.trim() !== '');
                if (valueP) return valueP.textContent.trim();
            }
        }

        return '';
    }

    function getBudgetAmount() {
        // 1. Intentar por etiqueta directa 'Presupuesto estimado'
        const directVal = getFieldValueByLabel('Presupuesto estimado');
        if (directVal && (directVal.includes('$') || /\d/.test(directVal))) {
            return directVal;
        }

        // 2. Búsqueda contextual cerca de 'Presupuesto estimado'
        const elements = Array.from(document.querySelectorAll('p, span'));
        const label = elements.find(el => el.textContent.trim().toLowerCase() === 'presupuesto estimado');
        if (label) {
            const container = label.closest('.MuiGrid-container');
            if (container) {
                const valP = Array.from(container.querySelectorAll('p')).find(p => p.textContent.includes('$'));
                if (valP) return valP.textContent.trim();
            }
        }

        return directVal || '';
    }

    function extractGeneralInfo() {
        return {
            codigo: extractQuotationCode() || '',
            nombre: getFieldValueByLabel('Nombre'),
            descripcion: getFieldValueByLabel('Descripción'),
            plazoEntrega: getFieldValueByLabel('Plazo máximo de entrega'),
            presupuesto: getBudgetAmount(),
            direccionEntrega: getFieldValueByLabel('Dirección de entrega'),
            fechaPublicacion: getFieldValueByLabel('Fecha de publicación')
        };
    }

    function getBuyerAttachmentElements() {
        const paragraphs = Array.from(document.querySelectorAll('p, span'));
        const adjuntosLabel = paragraphs.find(p => p.textContent.trim().toLowerCase() === 'adjuntos');
        if (!adjuntosLabel) return [];

        // Estrategia 1: Siguiente hermano en el grid
        const gridItem = adjuntosLabel.closest('.MuiGrid-item');
        if (gridItem && gridItem.nextElementSibling) {
            const anchors = Array.from(gridItem.nextElementSibling.querySelectorAll('a'));
            if (anchors.length > 0) {
                return anchors.filter(a => a.textContent.trim().length > 0);
            }
        }

        // Estrategia 2: Contenedor MuiGrid-container
        const container = adjuntosLabel.closest('.MuiGrid-container');
        if (container) {
            const anchors = Array.from(container.querySelectorAll('a'));
            if (anchors.length > 0) {
                return anchors.filter(a => a.textContent.trim().length > 0);
            }
        }

        return [];
    }

    async function downloadBuyerAttachments(rootFolder) {
        const docs = allOffersData?.documentosAdjuntos || [];
        let count = 0;

        if (docs.length > 0) {
            console.log('[Auditoría] Descargando adjuntos del comprador desde API interceptada:', docs);
            for (const doc of docs) {
                try {
                    const downloadUrl = `${CONFIG.api.downloadUrlBase}${doc.id}`;
                    const response = await fetch(downloadUrl, {
                        headers: { 'Authorization': allOffersData.token }
                    });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const blob = await response.blob();
                    const safeName = sanitizeFolderName(doc.filename || doc.nombreArchivo || doc.nombre || 'requerimiento');
                    const relativePath = `${rootFolder}/0.- Requerimientos Comprador/${safeName}`;

                    await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            chrome.runtime.sendMessage({
                                action: 'saveBlobAsFile',
                                base64: reader.result,
                                filename: relativePath
                            }, () => resolve());
                        };
                        reader.readAsDataURL(blob);
                    });
                    count++;
                    await delay(500);
                } catch (e) {
                    console.error('[Auditoría] Error descargando adjunto de comprador:', doc, e);
                }
            }
            return count;
        }

        const attachmentLinks = getBuyerAttachmentElements();
        if (!attachmentLinks || attachmentLinks.length === 0) {
            console.log('[Auditoría] No se encontraron adjuntos del comprador en la cotización.');
            return 0;
        }

        for (let i = 0; i < attachmentLinks.length; i++) {
            const link = attachmentLinks[i];
            const filename = sanitizeFolderName(link.textContent.trim()) || `requerimiento_${i + 1}`;
            const href = link.getAttribute('href');
            if (href && (href.startsWith('http') || href.startsWith('/'))) {
                try {
                    const fullUrl = href.startsWith('http') ? href : window.location.origin + href;
                    const response = await fetch(fullUrl, {
                        headers: { 'Authorization': allOffersData.token }
                    });
                    if (response.ok) {
                        const blob = await response.blob();
                        const relativePath = `${rootFolder}/0.- Requerimientos Comprador/${filename}`;
                        await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                                chrome.runtime.sendMessage({
                                    action: 'saveBlobAsFile',
                                    base64: reader.result,
                                    filename: relativePath
                                }, () => resolve());
                            };
                            reader.readAsDataURL(blob);
                        });
                        count++;
                        await delay(500);
                    }
                } catch (e) {
                    console.warn('[Auditoría] No se pudo descargar adjunto de comprador:', link, e);
                }
            }
        }

        return count;
    }

    function extractOffersData() {
        const cards = Array.from(document.querySelectorAll('.MuiPaper-root'));
        const data = [];

        for (const card of cards) {
            const fichaAnchor = card.querySelector('a[href*="proveedor.mercadopublico.cl/ficha"]');
            if (!fichaAnchor) continue; // No es tarjeta de oferta

            const razonSocial = fichaAnchor.textContent.trim();

            // Find RUT
            let rut = '';
            const rutMatch = card.innerHTML.match(/\b\d{1,2}\.\d{3}\.\d{3}-[0-9Kk]\b/);
            if (rutMatch) {
                rut = rutMatch[0];
            }

            // Find Vigencia
            let vigencia = '';
            const vigenciaEl = Array.from(card.querySelectorAll('span, p')).find(el => el.textContent.includes('VIGENCIA:'));
            if (vigenciaEl) {
                vigencia = vigenciaEl.textContent.replace('VIGENCIA:', '').trim();
            }

            // Find Price
            let price = '';
            const priceEl = card.querySelector('h3');
            if (priceEl && priceEl.textContent.includes('$')) {
                price = priceEl.textContent.trim();
            }

            // Find Description
            let description = '';
            const paragraphs = Array.from(card.querySelectorAll('p'));
            const descEl = paragraphs.find(p => {
                const text = p.textContent.trim();
                return text &&
                    !text.match(/\b\d{1,2}\.\d{3}\.\d{3}-[0-9Kk]\b/) &&
                    text !== 'Monto total' &&
                    !text.includes('Recibiste');
            });
            if (descEl) {
                description = descEl.textContent.trim();
            }

            // Check if marked INADMISIBLE
            const isInadmisible = Array.from(card.querySelectorAll('span, div, p')).some(el => el.textContent.trim() === 'INADMISIBLE');

            // Find Motivo de inadmisibilidad si existe
            let motivoInadmisible = '';
            if (isInadmisible) {
                const motivoEl = Array.from(card.querySelectorAll('h1, p, span, div')).find(el => el.textContent.includes('Motivo de inadmisibilidad'));
                if (motivoEl) {
                    motivoInadmisible = motivoEl.textContent.replace('Motivo de inadmisibilidad:', '').trim();
                }
            }

            data.push({
                razonSocial,
                rut,
                description,
                vigencia,
                price,
                inadmisible: isInadmisible ? 'SÍ' : 'NO',
                motivoInadmisible
            });
        }

        return data;
    }

    async function exportOffersExcel(quotaCode, rootFolder) {
        const data = extractOffersData();
        if (data.length === 0) {
            console.warn("[MP Descargas] No se encontraron datos de ofertas en pantalla para exportar.");
            return false;
        }

        const generalInfo = extractGeneralInfo();

        const escapeCsv = (val) => {
            if (val == null) return '""';
            return `"${String(val).replace(/"/g, '""').replace(/\r?\n/g, ' ').trim()}"`;
        };

        const lines = [];

        // 1. Información General de la Compra Ágil (encabezado superior sobre la tabla)
        if (generalInfo.codigo) {
            lines.push(`${escapeCsv('Cotización')};${escapeCsv(generalInfo.codigo)}`);
        }
        if (generalInfo.nombre) {
            lines.push(`${escapeCsv('Nombre')};${escapeCsv(generalInfo.nombre)}`);
        }
        if (generalInfo.descripcion) {
            lines.push(`${escapeCsv('Descripción')};${escapeCsv(generalInfo.descripcion)}`);
        }
        if (generalInfo.plazoEntrega) {
            lines.push(`${escapeCsv('Plazo máximo de entrega')};${escapeCsv(generalInfo.plazoEntrega)}`);
        }
        if (generalInfo.presupuesto) {
            lines.push(`${escapeCsv('Presupuesto estimado')};${escapeCsv(generalInfo.presupuesto)}`);
        }
        if (generalInfo.direccionEntrega) {
            lines.push(`${escapeCsv('Dirección de entrega')};${escapeCsv(generalInfo.direccionEntrega)}`);
        }
        if (generalInfo.fechaPublicacion) {
            lines.push(`${escapeCsv('Fecha de publicación')};${escapeCsv(generalInfo.fechaPublicacion)}`);
        }

        // Fila vacía para separar la información general de la tabla de ofertas
        lines.push('');

        // 2. Encabezados de la tabla de ofertas
        const headers = ["Razón Social", "RUT", "Descripción de la Oferta", "Vigencia", "Monto Total", "Inadmisible", "Motivo de Inadmisibilidad"];
        lines.push(headers.map(h => escapeCsv(h)).join(';'));

        // 3. Filas de ofertas
        for (const row of data) {
            lines.push([
                escapeCsv(row.razonSocial),
                escapeCsv(row.rut),
                escapeCsv(row.description),
                escapeCsv(row.vigencia),
                escapeCsv(row.price),
                escapeCsv(row.inadmisible),
                escapeCsv(row.motivoInadmisible)
            ].join(';'));
        }

        const csvContent = "\ufeff" + lines.join("\r\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const fileName = `Ofertas_${quotaCode}.csv`;
        const relativePath = `${rootFolder}/${fileName}`;

        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64Data = reader.result;
                chrome.runtime.sendMessage({
                    action: 'saveBlobAsFile',
                    base64: base64Data,
                    filename: relativePath
                }, (res) => {
                    if (chrome.runtime.lastError || !res || !res.success) {
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.setAttribute("href", url);
                        link.setAttribute("download", fileName);
                        link.style.visibility = 'hidden';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }
                    resolve(true);
                });
            };
            reader.readAsDataURL(blob);
        });
    }

    async function handleExportOffersExcel() {
        const quotaCode = extractQuotationCode() || 'exportacion';
        const rootFolder = sanitizeFolderName(quotaCode);
        const success = await exportOffersExcel(quotaCode, rootFolder);
        if (!success) {
            alert("No se encontraron datos de ofertas en la pantalla para exportar.");
        }
    }

    function handleDownloadAllOffers() {
        if (!allOffersData || !allOffersData.ofertas || !allOffersData.token) return;

        const button = document.getElementById(CONFIG.ids.downloadAllButton);
        const quotaCode = extractQuotationCode();
        const rootFolder = sanitizeFolderName(quotaCode);

        // --- LÓGICA DE FILTRADO ---
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

        // Enviar mensaje al background script para descargar ÚNICAMENTE las ofertas
        chrome.runtime.sendMessage({
            action: 'downloadAllOffers',
            ofertas: filteredOfertas,
            token: allOffersData.token,
            rootFolder: rootFolder
        }, (response) => {
            button.textContent = CONFIG.texts.buttonDone;

            setTimeout(() => {
                button.textContent = CONFIG.texts.buttonBulkInitial;
                button.disabled = false;
            }, 3000);
        });
    }

    async function handleFullAuditDownload() {
        if (!allOffersData || !allOffersData.ofertas || !allOffersData.token) {
            alert("Aún no se han cargado los datos de las ofertas en la página.");
            return;
        }

        const button = document.getElementById('mp-audit-all-offers');
        const quotaCode = extractQuotationCode() || 'exportacion';
        const rootFolder = sanitizeFolderName(quotaCode);

        button.textContent = '⏳ Iniciando auditoría...';
        button.disabled = true;

        try {
            // 1. Descargar requerimientos del comprador en "0.- Requerimientos Comprador"
            button.textContent = '⏳ Descargando requerimientos...';
            const buyerAttachmentsCount = await downloadBuyerAttachments(rootFolder);
            console.log(`[Auditoría] Descargados ${buyerAttachmentsCount} requerimiento(s) del comprador.`);

            // Limpiar modo captura en background si existiera
            chrome.runtime.sendMessage({ action: 'clearBuyerAttachments' }).catch(() => {});

            // 2. Exportar el nuevo Excel consolidado con datos generales en la cabecera
            button.textContent = '⏳ Generando Excel consolidado...';
            await exportOffersExcel(quotaCode, rootFolder);
            console.log('[Auditoría] Excel consolidado generado.');

            // 3. Filtrar ofertas válidas (omitir las marcadas como INADMISIBLE)
            const filteredOfertas = allOffersData.ofertas.filter(oferta => {
                const providerName = oferta.razonSocial || oferta.nombre;
                const cards = Array.from(document.querySelectorAll('.MuiPaper-root'));
                const matchingCard = cards.find(card => card.textContent.includes(providerName));

                if (matchingCard) {
                    const isRejected = Array.from(matchingCard.querySelectorAll('span, div')).some(el => {
                        return el && el.textContent && el.textContent.trim() === 'INADMISIBLE';
                    });
                    if (isRejected) {
                        console.log(`[Auditoría] Saltando oferta de ${providerName} (Marcada como INADMISIBLE)`);
                        return false;
                    }
                }
                return true;
            });

            if (filteredOfertas.length === 0) {
                button.textContent = '✅ Completado';
                setTimeout(() => {
                    button.textContent = '✨ Auditar cotización (Todo en 1)';
                    button.disabled = false;
                }, 3000);
                return;
            }

            button.textContent = '⏳ Descargando ofertas de proveedores...';

            // 4. Descargar adjuntos de las ofertas de proveedores
            chrome.runtime.sendMessage({
                action: 'downloadAllOffers',
                ofertas: filteredOfertas,
                token: allOffersData.token,
                rootFolder: rootFolder
            }, (response) => {
                button.textContent = '✅ Completado';

                setTimeout(() => {
                    button.textContent = '✨ Auditar cotización (Todo en 1)';
                    button.disabled = false;
                }, 3000);
            });

        } catch (err) {
            console.error('[Auditoría] Error durante el proceso:', err);
            button.textContent = '❌ Error';
            setTimeout(() => {
                button.textContent = '✨ Auditar cotización (Todo en 1)';
                button.disabled = false;
            }, 3000);
        }
    }

    function injectDownloadButton() {
        if (document.getElementById(CONFIG.ids.downloadButton)) return;

        // Buscar el título "Adjuntos de la cotización"
        const paragraphs = Array.from(document.querySelectorAll(CONFIG.selectors.attachmentTitle));
        const targetEl = paragraphs.find(p => p.textContent.includes(CONFIG.texts.attachmentTitleText));

        if (!targetEl) return;

        const button = document.createElement('button');
        button.id = CONFIG.ids.downloadButton;
        button.textContent = CONFIG.texts.buttonInitial;
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
        button.onclick = handleBulkDownload;

        targetEl.insertAdjacentElement('afterend', button);
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

        // Botón 1: Descargar ÚNICAMENTE las ofertas (como antes, nada más)
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

        // Botón 2: Exportar tabla a Excel
        const excelBtn = document.createElement('button');
        excelBtn.id = 'mp-export-offers-excel';
        excelBtn.textContent = '📊 Exportar tabla a Excel';
        Object.assign(excelBtn.style, {
            marginLeft: '10px',
            padding: '6px 12px',
            backgroundColor: '#1f7246', // Verde Excel
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
        excelBtn.onclick = handleExportOffersExcel;

        // Botón 3: NUEVO BOTÓN para auditar cotización (Requerimientos comprador + Excel + Ofertas)
        const auditBtn = document.createElement('button');
        auditBtn.id = 'mp-audit-all-offers';
        auditBtn.textContent = '✨ Auditar cotización (Todo en 1)';
        Object.assign(auditBtn.style, {
            marginLeft: '10px',
            padding: '6px 12px',
            backgroundColor: '#5b21b6', // Púrpura distintivo
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 'bold',
            display: 'inline-block',
            textAlign: 'center',
            verticalAlign: 'middle'
        });
        auditBtn.onclick = handleFullAuditDownload;

        // Inyectamos los botones después del contenedor del texto
        injectionWrapper.insertAdjacentElement('afterend', auditBtn);
        injectionWrapper.insertAdjacentElement('afterend', excelBtn);
        injectionWrapper.insertAdjacentElement('afterend', button);
    }

    injectApiInterceptor();
    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || !event.data.type) return;

        if (event.data.type === 'MP_DATA_FROM_PAGE') {
            interceptedData = event.data.payload;
            if (event.data.payload?.token) {
                chrome.runtime.sendMessage({ action: 'setAuthToken', token: event.data.payload.token }).catch(() => {});
            }
            setTimeout(injectDownloadButton, 500);
        } else if (event.data.type === 'MP_ALL_OFFERS_FROM_PAGE') {
            allOffersData = event.data.payload;
            if (event.data.payload?.token) {
                chrome.runtime.sendMessage({ action: 'setAuthToken', token: event.data.payload.token }).catch(() => {});
            }
            setTimeout(injectDownloadAllButton, 500);
        }
    });

    // Escucha mensajes de progreso enviados por el background script durante la descarga masiva
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'downloadProgress') {
            const button = document.getElementById(CONFIG.ids.downloadAllButton);
            if (button && button.disabled) {
                button.textContent = `⏳ Descargando oferta ${request.currentOffer}/${request.totalOffers} (${request.filesDownloaded} archivos)...`;
            }
            const auditBtn = document.getElementById('mp-audit-all-offers');
            if (auditBtn && auditBtn.disabled) {
                auditBtn.textContent = `⏳ Descargando oferta ${request.currentOffer}/${request.totalOffers} (${request.filesDownloaded} archivos)...`;
            }
        }
    });
})();