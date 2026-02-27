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

    function processAndSendData(responseText, requestHeaders, url) {
        try {
            const data = JSON.parse(responseText);
            const authToken = requestHeaders ? (typeof requestHeaders.get === 'function' ? requestHeaders.get('Authorization') : requestHeaders['Authorization']) : null;

            if (!authToken) return;

            // Revisamos si es la respuesta de TODAS las ofertas de la solicitud
            if (url && url.includes(CONFIG.api.processUrlPattern) && !url.includes(CONFIG.api.detailsUrlPattern)) {
                if (data?.payload?.ofertas && data.payload.ofertas.length > 0) {
                    window.postMessage({
                        type: CONFIG.processDataMessageType,
                        payload: {
                            ofertas: data.payload.ofertas,
                            token: authToken
                        }
                    }, window.location.origin);
                }
            }

            // Mantenemos la lógica anterior para la obtención del modal individual
            if (data?.payload?.documentosAdjuntos) {
                window.postMessage({
                    type: CONFIG.messageType,
                    payload: {
                        files: data.payload.documentosAdjuntos,
                        token: authToken
                    }
                }, window.location.origin);
            }

        } catch (e) { }
    }

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const url = args[0] instanceof Request ? args[0].url : args[0];
        const requestHeaders = args[1]?.headers;
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