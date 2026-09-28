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
                            }, (res) => {
                                if (chrome.runtime.lastError) {
                                    console.warn('[Auditoría] Error al guardar archivo:', chrome.runtime.lastError.message);
                                }
                                resolve(res);
                            });
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
                                }, (res) => {
                                    if (chrome.runtime.lastError) {
                                        console.warn('[Auditoría] Error al guardar archivo:', chrome.runtime.lastError.message);
                                    }
                                    resolve(res);
                                });
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

            // Detectar si es Empresa de Menor Tamaño (EMT)
            const isEmt = /empresa\s+de\s+menor\s+tama[ñn]o/i.test(card.textContent);
            const emt = isEmt ? 'EMPRESA DE MENOR TAMAÑO' : 'NO EMT';

            data.push({
                razonSocial,
                rut,
                emt,
                description,
                vigencia,
                price,
                inadmisible: isInadmisible ? 'SÍ' : 'NO',
                motivoInadmisible
            });
        }

        return data;
    }

    function extractRequestedProducts() {
        const products = [];
        let candidateCards = [];

        // Estrategia 1: Buscar por encabezado de sección h1-h6 con "productos solicitados"
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        const sectionHeading = headings.find(el => el.textContent.toLowerCase().includes('productos solicitados'));

        if (sectionHeading) {
            // En el DOM de Compra Ágil:
            // h3 -> Grid-item -> Grid-container (cabecera)
            // Hermano del Grid-container: Grid-container con las tarjetas
            // Y el contenedor común: Grid-item (md-8)
            const headerContainer = sectionHeading.closest('.MuiGrid-container');
            if (headerContainer && headerContainer.nextElementSibling) {
                const siblingPapers = Array.from(headerContainer.nextElementSibling.querySelectorAll('.MuiPaper-root'));
                if (siblingPapers.length > 0) {
                    candidateCards = siblingPapers;
                }
            }
            if (candidateCards.length === 0) {
                const mdContainer = sectionHeading.closest('.MuiGrid-grid-md-8') || sectionHeading.closest('.MuiGrid-item');
                if (mdContainer) {
                    const mdPapers = Array.from(mdContainer.querySelectorAll('.MuiPaper-root'));
                    if (mdPapers.length > 0) {
                        candidateCards = mdPapers;
                    }
                }
            }
        }

        // Estrategia 2: Búsqueda en todo el documento de tarjetas .MuiPaper-root que tengan "ID:" y "Cantidad"
        // y que no pertenezcan al bloque de ofertas ni a la ficha del comprador
        if (candidateCards.length === 0) {
            const allPapers = Array.from(document.querySelectorAll('.MuiPaper-root'));
            candidateCards = allPapers.filter(card => {
                if (card.querySelector('a[href*="proveedor.mercadopublico.cl/ficha"]')) return false;
                if (card.querySelector('a[href*="comprador.mercadopublico.cl/ficha"]')) return false;
                if (card.textContent.includes('Monto total')) return false;
                if (card.textContent.includes('Recibiste') && card.textContent.includes('cotizaciones')) return false;

                const text = card.textContent;
                const hasId = /ID\s*:/i.test(text);
                const hasCantidad = /cantidad/i.test(text);
                return hasId && hasCantidad;
            });
        }

        console.log(`[KodaTools] Tarjetas de productos detectadas: ${candidateCards.length}`);

        for (const card of candidateCards) {
            if (card.querySelector('a[href*="proveedor.mercadopublico.cl/ficha"]')) continue;
            if (card.querySelector('a[href*="comprador.mercadopublico.cl/ficha"]')) continue;

            const allElements = Array.from(card.querySelectorAll('p, span, div, h1, h2, h3, h4'));

            // --- 1. ID ---
            let id = '';
            const idEl = allElements.find(el => /ID\s*:/i.test(el.textContent));
            if (idEl) {
                const match = idEl.textContent.match(/ID\s*:\s*(\d+)/i);
                if (match) id = match[1];
            }
            if (!id) {
                const match = card.textContent.match(/ID\s*:\s*(\d+)/i);
                if (match) id = match[1];
            }

            // --- 2. NOMBRE (Nombre del rubro/categoría ONU) ---
            let nombre = '';
            if (idEl) {
                const col1 = idEl.closest('.MuiGrid-item') || idEl.parentElement;
                if (col1) {
                    const col1Ps = Array.from(col1.querySelectorAll('p, span'));
                    const nameEl = col1Ps.find(p => p !== idEl && !/ID\s*:/i.test(p.textContent) && p.textContent.trim().length > 0);
                    if (nameEl) nombre = nameEl.textContent.trim();
                }
            }
            if (!nombre) {
                const col1 = card.querySelector('.MuiGrid-grid-sm-3');
                if (col1) {
                    const nameEl = Array.from(col1.querySelectorAll('p, span')).find(p => !/ID\s*:/i.test(p.textContent) && p.textContent.trim().length > 0);
                    if (nameEl) nombre = nameEl.textContent.trim();
                }
            }

            // --- 3. DESCRIPCION (Detalle o especificación del producto) ---
            let descripcion = '';
            if (idEl) {
                const col1 = idEl.closest('.MuiGrid-item');
                if (col1 && col1.nextElementSibling) {
                    const descP = col1.nextElementSibling.querySelector('p');
                    if (descP && descP.textContent.trim()) {
                        descripcion = descP.textContent.trim();
                    }
                }
            }
            if (!descripcion) {
                const colDesc = card.querySelector('.MuiGrid-grid-sm-7');
                if (colDesc) {
                    const p = colDesc.querySelector('p');
                    if (p && p.textContent.trim()) descripcion = p.textContent.trim();
                }
            }
            if (!descripcion) {
                const allPs = Array.from(card.querySelectorAll('p'));
                const descP = allPs.find(p => {
                    const t = p.textContent.trim();
                    return t &&
                        t !== nombre &&
                        !/ID\s*:/i.test(t) &&
                        t.toLowerCase() !== 'cantidad' &&
                        !t.toLowerCase().includes('unidad');
                });
                if (descP) descripcion = descP.textContent.trim();
            }
            // Limpieza de comillas y saltos de línea innecesarios
            descripcion = descripcion
                .replace(/^["'“”«»]+|["'“”«»]+$/g, '')
                .replace(/\r?\n\s*/g, ' ')
                .trim();

            // --- 4. CANTIDAD ---
            let cantidad = '';
            const h3 = card.querySelector('h3');
            if (h3 && /\d/.test(h3.textContent)) {
                cantidad = h3.textContent.trim();
            } else {
                const cantLabel = allElements.find(p => p.textContent.trim().toLowerCase() === 'cantidad');
                if (cantLabel) {
                    const cantCol = cantLabel.closest('.MuiGrid-item') || cantLabel.parentElement;
                    if (cantCol) {
                        const valEl = Array.from(cantCol.querySelectorAll('h1, h2, h3, h4, p, span'))
                            .find(el => el !== cantLabel && /\d/.test(el.textContent));
                        if (valEl) cantidad = valEl.textContent.trim();
                    }
                }
            }
            cantidad = cantidad.replace(/\s+/g, ' ').trim();

            if (id || nombre || descripcion || cantidad) {
                products.push({ id, nombre, descripcion, cantidad });
            }
        }

        // Si el DOM no tenía tarjetas pero la API interceptada capturó productos, usar como respaldo
        if (products.length === 0 && allOffersData?.productos && Array.isArray(allOffersData.productos) && allOffersData.productos.length > 0) {
            console.log('[KodaTools] Usando productos capturados desde la API:', allOffersData.productos.length);
            for (const item of allOffersData.productos) {
                products.push({
                    id: String(item.id || item.codigoProducto || item.idProducto || ''),
                    nombre: String(item.nombre || item.rubro || item.categoria || ''),
                    descripcion: String(item.descripcion || item.detalle || item.especificacion || ''),
                    cantidad: String(item.cantidad != null ? (item.unidadMedida ? `${item.cantidad} ${item.unidadMedida}` : item.cantidad) : '')
                });
            }
        }

        console.log(`[KodaTools] Productos extraídos: ${products.length}`, products);
        return products;
    }

    // --- GENERADOR XLSX NATIVO MULTI-HOJA (OpenXML) ---
    const CRC32_TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        CRC32_TABLE[i] = c >>> 0;
    }

    function calculateCrc32(bytes) {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) {
            crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    async function deflateBytes(bytes) {
        if (typeof CompressionStream !== 'undefined') {
            try {
                const cs = new CompressionStream('deflate-raw');
                const writer = cs.writable.getWriter();
                writer.write(bytes);
                writer.close();
                const reader = cs.readable.getReader();
                const chunks = [];
                let totalLength = 0;
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    totalLength += value.length;
                }
                const out = new Uint8Array(totalLength);
                let offset = 0;
                for (const chunk of chunks) {
                    out.set(chunk, offset);
                    offset += chunk.length;
                }
                return out;
            } catch (e) {
                console.warn('[KodaTools - XLSX] Fallback a compresión STORE:', e);
            }
        }
        return null;
    }

    function escapeXml(val) {
        if (val == null) return '';
        return String(val)
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function colToLetter(colIndex) {
        let temp, letter = '';
        let col = colIndex + 1;
        while (col > 0) {
            temp = (col - 1) % 26;
            letter = String.fromCharCode(65 + temp) + letter;
            col = Math.floor((col - temp) / 26);
        }
        return letter;
    }

    function buildWorksheetXml(sheet) {
        let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
        xml += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n';

        if (sheet.cols && sheet.cols.length > 0) {
            xml += '  <cols>\n';
            for (const col of sheet.cols) {
                xml += `    <col min="${col.min}" max="${col.max}" width="${col.width}" customWidth="1"/>\n`;
            }
            xml += '  </cols>\n';
        }

        xml += '  <sheetData>\n';
        const rows = sheet.rows || [];
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            const rowNum = r + 1;
            if (!row || row.length === 0) {
                xml += `    <row r="${rowNum}"/>\n`;
                continue;
            }
            xml += `    <row r="${rowNum}">\n`;
            for (let c = 0; c < row.length; c++) {
                const cell = row[c];
                if (cell == null) continue;
                const cellRef = `${colToLetter(c)}${rowNum}`;
                const val = typeof cell === 'object' && cell !== null ? (cell.val ?? '') : cell;
                const style = typeof cell === 'object' && cell !== null && cell.style ? ` s="${cell.style}"` : '';
                xml += `      <c r="${cellRef}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(val)}</t></is></c>\n`;
            }
            xml += '    </row>\n';
        }
        xml += '  </sheetData>\n';
        xml += '</worksheet>';
        return xml;
    }

    async function createZipArchive(files) {
        const encoder = new TextEncoder();
        const localHeaders = [];
        const centralHeaders = [];
        let offset = 0;

        for (const file of files) {
            const nameBytes = encoder.encode(file.name);
            const uncompressedData = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
            const uncompressedSize = uncompressedData.length;
            const fileCrc = calculateCrc32(uncompressedData);

            const deflated = await deflateBytes(uncompressedData);
            const isDeflated = deflated !== null && deflated.length < uncompressedSize;
            const method = isDeflated ? 8 : 0;
            const compressedData = isDeflated ? deflated : uncompressedData;
            const compressedSize = compressedData.length;

            // Encabezado Local (30 bytes + nombre + datos comprimidos)
            const localHeader = new Uint8Array(30 + nameBytes.length + compressedSize);
            const lView = new DataView(localHeader.buffer);

            lView.setUint32(0, 0x04034b50, true);
            lView.setUint16(4, 20, true);
            lView.setUint16(6, 0x0800, true); // UTF-8
            lView.setUint16(8, method, true);
            lView.setUint16(10, 0, true);
            lView.setUint16(12, 0x21, true); // 1980-01-01
            lView.setUint32(14, fileCrc, true);
            lView.setUint32(18, compressedSize, true);
            lView.setUint32(22, uncompressedSize, true);
            lView.setUint16(26, nameBytes.length, true);
            lView.setUint16(28, 0, true);
            localHeader.set(nameBytes, 30);
            localHeader.set(compressedData, 30 + nameBytes.length);

            localHeaders.push(localHeader);

            // Directorio Central (46 bytes + nombre)
            const centralHeader = new Uint8Array(46 + nameBytes.length);
            const cView = new DataView(centralHeader.buffer);

            cView.setUint32(0, 0x02014b50, true);
            cView.setUint16(4, 20, true);
            cView.setUint16(6, 20, true);
            cView.setUint16(8, 0x0800, true);
            cView.setUint16(10, method, true);
            cView.setUint16(12, 0, true);
            cView.setUint16(14, 0x21, true);
            cView.setUint32(16, fileCrc, true);
            cView.setUint32(20, compressedSize, true);
            cView.setUint32(24, uncompressedSize, true);
            cView.setUint16(28, nameBytes.length, true);
            cView.setUint16(30, 0, true);
            cView.setUint16(32, 0, true);
            cView.setUint16(34, 0, true);
            cView.setUint16(36, 0, true);
            cView.setUint32(38, 0, true);
            cView.setUint32(42, offset, true);
            centralHeader.set(nameBytes, 46);

            centralHeaders.push(centralHeader);
            offset += localHeader.length;
        }

        const centralDirectoryOffset = offset;
        let centralDirectorySize = 0;
        for (const ch of centralHeaders) {
            centralDirectorySize += ch.length;
        }

        // Fin de Directorio Central (EOCD - 22 bytes)
        const eocd = new Uint8Array(22);
        const eView = new DataView(eocd.buffer);
        eView.setUint32(0, 0x06054b50, true);
        eView.setUint16(4, 0, true);
        eView.setUint16(6, 0, true);
        eView.setUint16(8, files.length, true);
        eView.setUint16(10, files.length, true);
        eView.setUint32(12, centralDirectorySize, true);
        eView.setUint32(16, centralDirectoryOffset, true);
        eView.setUint16(20, 0, true);

        // Ensamblar archivo ZIP completo
        const totalSize = offset + centralDirectorySize + 22;
        const zipBytes = new Uint8Array(totalSize);
        let curOffset = 0;
        for (const lh of localHeaders) {
            zipBytes.set(lh, curOffset);
            curOffset += lh.length;
        }
        for (const ch of centralHeaders) {
            zipBytes.set(ch, curOffset);
            curOffset += ch.length;
        }
        zipBytes.set(eocd, curOffset);

        return zipBytes;
    }

    async function buildXlsxWorkbook(sheets) {
        const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((_, i) => `  <Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

        const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

        const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `  <Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

        const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews>
    <workbookView xWindow="0" yWindow="0" windowWidth="20480" windowHeight="10240"/>
  </bookViews>
  <sheets>
${sheets.map((s, i) => `    <sheet name="${escapeXml(s.name.substring(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('\n')}
  </sheets>
</workbook>`;

        const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font>
      <name val="Calibri"/>
      <sz val="11"/>
    </font>
    <font>
      <b/>
      <name val="Calibri"/>
      <sz val="11"/>
      <color rgb="FFFFFFFF"/>
    </font>
    <font>
      <b/>
      <name val="Calibri"/>
      <sz val="11"/>
    </font>
  </fonts>
  <fills count="3">
    <fill>
      <patternFill patternType="none"/>
    </fill>
    <fill>
      <patternFill patternType="gray125"/>
    </fill>
    <fill>
      <patternFill patternType="solid">
        <fgColor rgb="FF1F7246"/>
        <bgColor indexed="64"/>
      </patternFill>
    </fill>
  </fills>
  <borders count="1">
    <border>
      <left/>
      <right/>
      <top/>
      <bottom/>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`;

        const files = [
            { name: '[Content_Types].xml', data: contentTypesXml },
            { name: '_rels/.rels', data: rootRelsXml },
            { name: 'xl/workbook.xml', data: workbookXml },
            { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml },
            { name: 'xl/styles.xml', data: stylesXml }
        ];

        sheets.forEach((sheet, i) => {
            files.push({
                name: `xl/worksheets/sheet${i + 1}.xml`,
                data: buildWorksheetXml(sheet)
            });
        });

        return await createZipArchive(files);
    }

    async function exportOffersExcel(quotaCode, rootFolder) {
        const offers = extractOffersData();
        const products = extractRequestedProducts();

        if (offers.length === 0 && products.length === 0) {
            console.warn("[MP Descargas] No se encontraron datos de ofertas ni productos en pantalla para exportar.");
            return false;
        }

        const generalInfo = extractGeneralInfo();

        // --- HOJA 1: Datos actuales (Información General + Tabla de Ofertas) ---
        const sheet1Rows = [];
        if (generalInfo.codigo) {
            sheet1Rows.push([{ val: 'Cotización', style: 2 }, { val: generalInfo.codigo }]);
        }
        if (generalInfo.nombre) {
            sheet1Rows.push([{ val: 'Nombre', style: 2 }, { val: generalInfo.nombre }]);
        }
        if (generalInfo.descripcion) {
            sheet1Rows.push([{ val: 'Descripción', style: 2 }, { val: generalInfo.descripcion }]);
        }
        if (generalInfo.plazoEntrega) {
            sheet1Rows.push([{ val: 'Plazo máximo de entrega', style: 2 }, { val: generalInfo.plazoEntrega }]);
        }
        if (generalInfo.presupuesto) {
            sheet1Rows.push([{ val: 'Presupuesto estimado', style: 2 }, { val: generalInfo.presupuesto }]);
        }
        if (generalInfo.direccionEntrega) {
            sheet1Rows.push([{ val: 'Dirección de entrega', style: 2 }, { val: generalInfo.direccionEntrega }]);
        }
        if (generalInfo.fechaPublicacion) {
            sheet1Rows.push([{ val: 'Fecha de publicación', style: 2 }, { val: generalInfo.fechaPublicacion }]);
        }

        sheet1Rows.push([]); // Fila vacía separadora

        const offerHeaders = [
            "Razón Social",
            "RUT",
            "Empresa Menor Tamaño",
            "Descripción de la Oferta",
            "Vigencia",
            "Monto Total",
            "Inadmisible",
            "Motivo de Inadmisibilidad"
        ];
        sheet1Rows.push(offerHeaders.map(h => ({ val: h, style: 1 })));

        if (offers.length > 0) {
            for (const row of offers) {
                sheet1Rows.push([
                    { val: row.razonSocial },
                    { val: row.rut },
                    { val: row.emt },
                    { val: row.description },
                    { val: row.vigencia },
                    { val: row.price },
                    { val: row.inadmisible },
                    { val: row.motivoInadmisible }
                ]);
            }
        } else {
            sheet1Rows.push([{ val: "No se encontraron ofertas registradas en pantalla." }]);
        }

        // --- HOJA 2: Listado de Productos Solicitados (ID | NOMBRE | DESCRIPCION | CANTIDAD) ---
        const sheet2Rows = [];
        const productHeaders = ["ID", "NOMBRE", "DESCRIPCION", "CANTIDAD"];
        sheet2Rows.push(productHeaders.map(h => ({ val: h, style: 1 })));

        if (products.length > 0) {
            for (const prod of products) {
                sheet2Rows.push([
                    { val: prod.id },
                    { val: prod.nombre },
                    { val: prod.descripcion },
                    { val: prod.cantidad }
                ]);
            }
        } else {
            sheet2Rows.push([{ val: "No se encontraron productos solicitados en pantalla." }]);
        }

        const sheets = [
            {
                name: 'Ofertas',
                rows: sheet1Rows,
                cols: [
                    { min: 1, max: 1, width: 35 },
                    { min: 2, max: 2, width: 18 },
                    { min: 3, max: 3, width: 28 },
                    { min: 4, max: 4, width: 45 },
                    { min: 5, max: 5, width: 18 },
                    { min: 6, max: 6, width: 20 },
                    { min: 7, max: 7, width: 15 },
                    { min: 8, max: 8, width: 40 }
                ]
            },
            {
                name: 'Productos Solicitados',
                rows: sheet2Rows,
                cols: [
                    { min: 1, max: 1, width: 18 },
                    { min: 2, max: 2, width: 32 },
                    { min: 3, max: 3, width: 55 },
                    { min: 4, max: 4, width: 20 }
                ]
            }
        ];

        const zipBytes = await buildXlsxWorkbook(sheets);
        const blob = new Blob([zipBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const fileName = `Ofertas_${quotaCode}.xlsx`;
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
        const button = document.getElementById('mp-export-offers-excel');
        const prevText = button ? button.textContent : '';
        if (button) {
            button.textContent = '⏳ Generando Excel...';
            button.disabled = true;
        }

        try {
            const quotaCode = extractQuotationCode() || 'exportacion';
            const rootFolder = sanitizeFolderName(quotaCode);
            const success = await exportOffersExcel(quotaCode, rootFolder);
            if (!success) {
                alert("No se encontraron ofertas ni productos en pantalla para exportar.");
            }
        } catch (e) {
            console.error('[KodaTools - Excel] Error generando archivo Excel:', e);
            alert("Ocurrió un error al generar el archivo Excel: " + (e.message || e));
        } finally {
            if (button) {
                button.textContent = prevText || '📊 Exportar tabla a Excel';
                button.disabled = false;
            }
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
            if (chrome.runtime.lastError) {
                console.error('[Descarga Masiva] Error de comunicación:', chrome.runtime.lastError.message);
                button.textContent = '❌ Error';
            } else {
                button.textContent = CONFIG.texts.buttonDone;
            }

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
            chrome.runtime.sendMessage({ action: 'clearBuyerAttachments' }).catch(() => { });

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
                    button.textContent = '✨ Descargar todo';
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
                if (chrome.runtime.lastError) {
                    console.error('[Auditoría] Error de comunicación:', chrome.runtime.lastError.message);
                    button.textContent = '❌ Error';
                } else {
                    button.textContent = '✅ Completado';
                }

                setTimeout(() => {
                    button.textContent = '✨ Descargar todo';
                    button.disabled = false;
                }, 3000);
            });

        } catch (err) {
            console.error('[Auditoría] Error durante el proceso:', err);
            button.textContent = '❌ Error';
            setTimeout(() => {
                button.textContent = '✨ Descargar todo';
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
        auditBtn.textContent = '✨ Descargar todo';
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
                chrome.runtime.sendMessage({ action: 'setAuthToken', token: event.data.payload.token }).catch(() => { });
            }
            setTimeout(injectDownloadButton, 500);
        } else if (event.data.type === 'MP_ALL_OFFERS_FROM_PAGE') {
            allOffersData = event.data.payload;
            if (event.data.payload?.token) {
                chrome.runtime.sendMessage({ action: 'setAuthToken', token: event.data.payload.token }).catch(() => { });
            }
            setTimeout(injectDownloadAllButton, 500);
        }
    });

    // Inyección periódica por si el DOM se actualiza o la navegación no recarga el script
    setInterval(injectDownloadButton, 2000);
    setInterval(injectDownloadAllButton, 2000);

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