/**
 * soykoda_bridge.js — Content Script Bridge entre MP Tools y SoyKoda.
 *
 * Inyectado con run_at: "document_start" exclusivamente en:
 *  - https://soykoda.cloud/*
 *  - http://localhost:3000/*
 *
 * Principios de seguridad:
 *  1. Validación estricta de origen (origin allowlist).
 *  2. Nonce anti-spoofing en cada mensaje request/response.
 *  3. Ningún Bearer token ni cookie de sesión cruza este puente hacia SoyKoda.
 *  4. El puente sólo transporta datos públicos estructurados o metadatos de descargas.
 */

(function initSoykodaBridge() {
  'use strict';

  // 1. Marca inmediata en el DOM para que la app cliente detecte la extensión
  function markDom() {
    if (document.documentElement) {
      document.documentElement.setAttribute('data-mp-tools', '1');
    }
  }

  markDom();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', markDom, { once: true });
  }

  // 2. Orígenes autorizados estrictos
  const ALLOWED_ORIGINS = new Set([
    'https://soykoda.cloud',
    'http://localhost:3000'
  ]);

  // 3. Tipos de mensaje permitidos desde la web
  const ALLOWED_REQUEST_TYPES = new Set([
    'MP_SOYKODA_PING',
    'MP_SOYKODA_FETCH'
  ]);

  // 4. Escuchar peticiones desde la aplicación web SoyKoda
  window.addEventListener('message', (event) => {
    // Validar origen exacto
    if (!ALLOWED_ORIGINS.has(event.origin)) {
      return;
    }

    // Validar estructura básica
    const data = event.data;
    if (!data || typeof data !== 'object') {
      return;
    }

    // Filtrar emisor y tipos
    if (data.source !== 'soykoda-web') {
      return;
    }

    if (!ALLOWED_REQUEST_TYPES.has(data.type)) {
      return;
    }

    // Validar nonce obligatorio para anti-spoofing
    const nonce = data.nonce;
    if (!nonce || typeof nonce !== 'string') {
      console.warn('[MP Tools Bridge] Mensaje ignorado: nonce inválido o ausente.');
      return;
    }

    // Reenviar mensaje al Service Worker (background.js)
    try {
      chrome.runtime.sendMessage(
        {
          action: 'SOYKODA_BRIDGE_MESSAGE',
          type: data.type,
          nonce: nonce,
          payload: data.payload || {}
        },
        (response) => {
          const lastError = chrome.runtime.lastError;

          if (lastError) {
            console.error('[MP Tools Bridge] Error de runtime:', lastError.message);
            window.postMessage(
              {
                source: 'mp-tools',
                type: 'MP_SOYKODA_RESULT',
                nonce: nonce,
                payload: {
                  ok: false,
                  error: {
                    code: 'FETCH_FAILED',
                    message: lastError.message || 'Error comunicándose con el servicio de la extensión.'
                  }
                }
              },
              event.origin
            );
            return;
          }

          if (!response) {
            window.postMessage(
              {
                source: 'mp-tools',
                type: 'MP_SOYKODA_RESULT',
                nonce: nonce,
                payload: {
                  ok: false,
                  error: {
                    code: 'FETCH_FAILED',
                    message: 'Sin respuesta del servicio de la extensión.'
                  }
                }
              },
              event.origin
            );
            return;
          }

          // Responder a la ventana con el nonce original
          window.postMessage(
            {
              source: 'mp-tools',
              type: response.type || (data.type === 'MP_SOYKODA_PING' ? 'MP_SOYKODA_PONG' : 'MP_SOYKODA_RESULT'),
              nonce: nonce,
              payload: response.payload
            },
            event.origin
          );
        }
      );
    } catch (err) {
      console.error('[MP Tools Bridge] Fallo crítico enviando a background:', err);
      window.postMessage(
        {
          source: 'mp-tools',
          type: 'MP_SOYKODA_RESULT',
          nonce: nonce,
          payload: {
            ok: false,
            error: {
              code: 'FETCH_FAILED',
              message: err instanceof Error ? err.message : 'Error inesperado en el puente.'
            }
          }
        },
        event.origin
      );
    }
  });

  console.log('[MP Tools Bridge] Puente SoyKoda inicializado y escuchando en', window.location.origin);
})();
