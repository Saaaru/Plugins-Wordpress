// Intercepta peticiones Fetch y XHR para capturar datos y token de autorización y enviarlos a la página
(function () {
    'use strict';

    const CONFIG = {
        api: {
            detailsUrlPattern: '/v1/compra-agil/solicitud/cotizacion/',
            processUrlPattern: '/v1/compra-agil/solicitud/' // Y que NO termine en /cotizacion/... (lo manejamos con regex o includes)
        },
        messageType: 'MP_DATA_FROM_PAGE',
        processDataMessageType: 'MP_ALL_OFFERS_FROM_PAGE'
    };

    let cachedAuthToken = null;

    function extractAuthToken(headers) {
        if (!headers) return null;

        // If it's a Headers instance (e.g. new Headers())
        if (typeof headers.get === 'function') {
            const token = headers.get('Authorization') || headers.get('authorization') || headers.get('AUTHORIZATION');
            if (token) return token;
        }

        // If it's a plain object or map
        if (typeof headers === 'object') {
            for (const key of Object.keys(headers)) {
                if (key.toLowerCase() === 'authorization') {
                    return headers[key];
                }
            }
        }
        return null;
    }

    function processAndSendData(responseText, requestHeaders, url) {
        try {
            const data = JSON.parse(responseText);
            const extractedToken = extractAuthToken(requestHeaders);
            if (extractedToken) {
                cachedAuthToken = extractedToken;
            }
            const authToken = extractedToken || cachedAuthToken;

            if (!authToken) {
                console.warn('[Descarga Masiva - Interceptor] No se encontró token Authorization activo.');
                return;
            }

            // Revisamos si es la respuesta de TODAS las ofertas de la solicitud
            if (url && url.includes(CONFIG.api.processUrlPattern) && !url.includes(CONFIG.api.detailsUrlPattern)) {
                if (data?.payload?.ofertas && data.payload.ofertas.length > 0) {
                    console.log('[Descarga Masiva - Interceptor] Capturadas', data.payload.ofertas.length, 'ofertas. Notificando a content script...');
                    window.postMessage({
                        type: CONFIG.processDataMessageType,
                        payload: {
                            ofertas: data.payload.ofertas,
                            documentosAdjuntos: data.payload.documentosAdjuntos || data.payload.archivos || [],
                            productos: data.payload.productos || data.payload.items || data.payload.articulos || data.payload.solicitudItems || [],
                            token: authToken
                        }
                    }, window.location.origin);
                }
            }

            // Mantenemos la lógica anterior para la obtención del modal individual
            if (data?.payload?.documentosAdjuntos) {
                console.log('[Descarga Masiva - Interceptor] Capturados adjuntos de oferta individual. Notificando...');
                window.postMessage({
                    type: CONFIG.messageType,
                    payload: {
                        files: data.payload.documentosAdjuntos,
                        token: authToken
                    }
                }, window.location.origin);
            }

        } catch (e) {
            console.error('[Descarga Masiva - Interceptor] Error procesando respuesta JSON:', e);
        }
    }

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const url = args[0] instanceof Request ? args[0].url : args[0];
        let requestHeaders = args[1]?.headers;
        if (!requestHeaders && args[0] instanceof Request) {
            requestHeaders = args[0].headers;
        }

        const token = extractAuthToken(requestHeaders);
        if (token) {
            cachedAuthToken = token;
        }

        const response = await originalFetch.apply(this, args);

        if (typeof url === 'string' && url.includes(CONFIG.api.processUrlPattern)) {
            const clonedResponse = response.clone();
            clonedResponse.text().then(responseText => processAndSendData(responseText, requestHeaders, url));
        }
        return response;
    };

    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    const originalXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this._mp_url = url;
        this._mp_headers = {};
        return originalXhrOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
        if (this._mp_headers) {
            this._mp_headers[header] = value;
        }
        if (header && header.toLowerCase() === 'authorization') {
            cachedAuthToken = value;
        }
        return originalXhrSetRequestHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        this.addEventListener('readystatechange', function () {
            if (this.readyState === 4 && this.status === 200 && typeof this._mp_url === 'string') {
                if (this._mp_url.includes(CONFIG.api.processUrlPattern)) {
                    processAndSendData(this.responseText, this._mp_headers, this._mp_url);
                }
            }
        }, false);
        return originalXhrSend.apply(this, args);
    };

    console.log('[Descarga Masiva - Interceptor] Interceptor UNIVERSAL (Fetch + XHR) activo para procesos completos e individuales.');
})();