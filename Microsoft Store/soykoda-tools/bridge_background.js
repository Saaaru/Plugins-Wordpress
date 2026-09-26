/**
 * bridge_background.js — Módulo background para el puente SoyKoda (MV3).
 *
 * Funcionalidades:
 *  1. Handshake MP_SOYKODA_PING -> MP_SOYKODA_PONG con reporte de capabilities y estado de sesión.
 *  2. Detección de sesión activa (Bearer token en memoria o probe ligero fetch con redirect: 'manual').
 *  3. Invocación de DOMParser mediante Offscreen Document para páginas WebForms legadas de Mercado Público.
 *  4. Ejecución de MP_SOYKODA_FETCH devolviendo JSON limpio sin tokens ni credenciales.
 */

let cachedAuthToken = null;
let sessionCache = {
  hasSession: null,
  timestamp: 0
};
const CACHE_TTL_MS = 45 * 1000; // 45 segundos de caché de probe

const ENDPOINTS = {
  compraAgilDetails: 'https://servicios-compra-agil.mercadopublico.cl/v1/compra-agil/solicitud/cotizacion/',
  compraAgilSolicitud: 'https://servicios-compra-agil.mercadopublico.cl/v1/compra-agil/solicitud/',
  licitacionVoucherBase: 'https://www.mercadopublico.cl/bid/modules/bid/voucherview.aspx?enc=',
  probeUrl: 'https://www.mercadopublico.cl/Portal/Modules/Site/Adquisiciones/'
};

/**
 * Valida la existencia de una sesión activa de Mercado Público.
 */
export async function checkMpSession(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && sessionCache.hasSession !== null && (now - sessionCache.timestamp < CACHE_TTL_MS)) {
    return sessionCache.hasSession;
  }

  // 1. Si existe un token Bearer activo en memoria, la sesión está garantizada
  if (cachedAuthToken && typeof cachedAuthToken === 'string' && cachedAuthToken.length > 20) {
    sessionCache = { hasSession: true, timestamp: now };
    return true;
  }

  // 2. Probe ligero con redirect: 'manual' contra un recurso protegido por cookies
  try {
    const res = await fetch(ENDPOINTS.probeUrl, {
      method: 'GET',
      credentials: 'include',
      redirect: 'manual'
    });

    // En modo redirect: 'manual', si la cookie expiró el servidor redirige a ClaveÚnica o login.
    // La respuesta en ese caso es 'opaqueredirect' (o status 301/302).
    if (res.type === 'opaqueredirect' || res.status === 302 || res.status === 301) {
      sessionCache = { hasSession: false, timestamp: now };
      return false;
    }

    if (res.ok || res.status === 200) {
      const text = await res.text();
      // Verificamos marcadores de login de ClaveÚnica
      if (
        text.includes('claveunica.gob.cl') ||
        text.includes('Iniciar sesión con ClaveÚnica') ||
        text.includes('login.aspx')
      ) {
        sessionCache = { hasSession: false, timestamp: now };
        return false;
      }
      sessionCache = { hasSession: true, timestamp: now };
      return true;
    }

    sessionCache = { hasSession: false, timestamp: now };
    return false;
  } catch (err) {
    console.warn('[Bridge BG] Error al verificar sesión de Mercado Público:', err);
    sessionCache = { hasSession: false, timestamp: now };
    return false;
  }
}

/**
 * Garantiza que el documento offscreen esté abierto para invocar DOMParser.
 */
async function ensureOffscreenDocument() {
  if (!chrome.offscreen) return;
  const existing = await chrome.offscreen.hasDocument?.();
  if (existing) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DOM_PARSER'],
    justification: 'Parsing HTML from Mercado Público to structured JSON'
  });
}

/**
 * Envia HTML al Offscreen Document y retorna datos estructurados.
 */
async function parseHtmlOffscreen(html, parserType = 'voucher') {
  await ensureOffscreenDocument();
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: 'OFFSCREEN_PARSE',
        html,
        parserType
      },
      (res) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          reject(new Error(lastErr.message));
        } else if (!res || !res.ok) {
          reject(new Error(res?.error?.message || 'Error en parseo offscreen.'));
        } else {
          resolve(res.data);
        }
      }
    );
  });
}

/**
 * Sanitiza cualquier objeto de datos para asegurar que NINGÚN token, cookie o credencial
 * pueda filtrarse accidentalmente hacia SoyKoda.
 */
function sanitizeDataPayload(data) {
  if (!data || typeof data !== 'object') return data;
  const copy = Array.isArray(data) ? [...data] : { ...data };

  const forbiddenKeys = [
    'token', 'authorization', 'bearer', 'cookie', 'session',
    'password', 'secret', 'auth', 'authtoken', '__viewstate'
  ];

  if (Array.isArray(copy)) {
    return copy.map((item) => sanitizeDataPayload(item));
  }

  for (const key of Object.keys(copy)) {
    const lower = key.toLowerCase();
    if (forbiddenKeys.some((f) => lower.includes(f))) {
      delete copy[key];
    } else if (typeof copy[key] === 'object' && copy[key] !== null) {
      copy[key] = sanitizeDataPayload(copy[key]);
    }
  }

  return copy;
}

/**
 * Manejador principal de peticiones del puente.
 */
async function handleBridgeRequest(request) {
  const { type, payload } = request;

  // 1. Handshake PING
  if (type === 'MP_SOYKODA_PING') {
    const hasMpSession = await checkMpSession();
    return {
      type: 'MP_SOYKODA_PONG',
      payload: {
        version: chrome.runtime.getManifest().version,
        capabilities: [
          'compra-agil',
          'licitaciones',
          'orden-compra',
          'voucher-download',
          'dom-parser-offscreen',
          'extension-snapshots'
        ],
        hasMpSession
      }
    };
  }

  // 2. Fetch de datos
  if (type === 'MP_SOYKODA_FETCH') {
    const hasMpSession = await checkMpSession();
    if (!hasMpSession) {
      return {
        type: 'MP_SOYKODA_RESULT',
        payload: {
          ok: false,
          error: {
            code: 'NO_SESSION',
            message: 'No hay una sesión activa de Mercado Público. Por favor inicia sesión con ClaveÚnica.'
          }
        }
      };
    }

    const codigo = payload?.codigo || '';
    const tipo = payload?.tipo || 'OC';
    const action = payload?.action || 'fetch';

    try {
      // ── CASO A: Compra Ágil (CO / AG) con API REST ──
      if (tipo === 'CO' || tipo === 'AG') {
        if (!cachedAuthToken) {
          return {
            type: 'MP_SOYKODA_RESULT',
            payload: {
              ok: false,
              error: {
                code: 'NO_SESSION',
                message: 'Se requiere interacción activa en Compra Ágil para capturar autorización.'
              }
            }
          };
        }

        const url = `${ENDPOINTS.compraAgilDetails}${encodeURIComponent(codigo)}`;
        const res = await fetch(url, {
          headers: { Authorization: cachedAuthToken }
        });

        if (res.status === 404) {
          return {
            type: 'MP_SOYKODA_RESULT',
            payload: { ok: false, error: { code: 'NOT_FOUND', message: 'Cotización no encontrada.' } }
          };
        }
        if (res.status === 429) {
          return {
            type: 'MP_SOYKODA_RESULT',
            payload: { ok: false, error: { code: 'RATE_LIMITED', message: 'Límite de solicitudes alcanzado en Mercado Público.' } }
          };
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const json = await res.json();
        const safeData = sanitizeDataPayload(json.payload || json);

        return {
          type: 'MP_SOYKODA_RESULT',
          payload: {
            ok: true,
            data: {
              codigo,
              tipo: 'CO',
              detalles: safeData
            }
          }
        };
      }

      // ── CASO B: Licitaciones (LP / LIC) u Órdenes de Compra (OC) ──
      // Si se solicita voucher o inspección por enc
      const enc = payload?.enc || payload?.ids?.[0] || '';
      if (enc) {
        const voucherUrl = `${ENDPOINTS.licitacionVoucherBase}${encodeURIComponent(enc)}`;
        const res = await fetch(voucherUrl, {
          credentials: 'include'
        });

        if (!res.ok) {
          throw new Error(`Error HTTP al consultar comprobante: ${res.status}`);
        }

        const html = await res.text();
        const parsed = await parseHtmlOffscreen(html, 'voucher');
        const safeData = sanitizeDataPayload(parsed);

        return {
          type: 'MP_SOYKODA_RESULT',
          payload: {
            ok: true,
            data: {
              codigo,
              tipo,
              archivos: safeData.files || [],
              paginas: safeData.totalPages || 1
            }
          }
        };
      }

      // Respuesta estructurada general para la ficha de Mercado Público
      return {
        type: 'MP_SOYKODA_RESULT',
        payload: {
          ok: true,
          data: {
            codigo,
            tipo,
            sincronizado: true,
            timestamp: new Date().toISOString()
          }
        }
      };
    } catch (err) {
      console.error('[Bridge BG] Error ejecutando MP_SOYKODA_FETCH:', err);
      return {
        type: 'MP_SOYKODA_RESULT',
        payload: {
          ok: false,
          error: {
            code: 'FETCH_FAILED',
            message: err instanceof Error ? err.message : 'Error al consultar Mercado Público.'
          }
        }
      };
    }
  }

  return {
    type: 'MP_SOYKODA_RESULT',
    payload: {
      ok: false,
      error: { code: 'FETCH_FAILED', message: 'Tipo de mensaje desconocido.' }
    }
  };
}

/**
 * Registra listeners de fondo para el puente y la captura de tokens.
 */
export function initBridgeHandler() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 1. Mensajes dirigidos al puente desde soykoda_bridge.js
    if (request.action === 'SOYKODA_BRIDGE_MESSAGE') {
      handleBridgeRequest(request)
        .then((res) => sendResponse(res))
        .catch((err) => {
          sendResponse({
            type: 'MP_SOYKODA_RESULT',
            payload: {
              ok: false,
              error: { code: 'FETCH_FAILED', message: err.message || 'Error interno.' }
            }
          });
        });
      return true; // async sendResponse
    }

    // 2. Registro de token capturado por content.js
    if (request.action === 'setAuthToken' && request.token) {
      cachedAuthToken = request.token;
      sessionCache = { hasSession: true, timestamp: Date.now() };
      sendResponse({ success: true });
      return false;
    }
  });

  console.log('[Bridge BG] Módulo SoyKoda Bridge inicializado.');
}
