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

// Restauración inmediata del token persistido desde chrome.storage.local (resiste suspensión de MV3)
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get(['mpAuthToken'], (result) => {
    if (result && result.mpAuthToken) {
      cachedAuthToken = result.mpAuthToken;
      sessionCache = { hasSession: true, timestamp: Date.now() };
      console.log('[Bridge BG] Token de sesión restaurado desde storage local.');
    }
  });
}

const ENDPOINTS = {
  compraAgilDetails: 'https://servicios-compra-agil.mercadopublico.cl/v1/compra-agil/solicitud/cotizacion/',
  compraAgilSolicitud: 'https://servicios-compra-agil.mercadopublico.cl/v1/compra-agil/solicitud/',
  compraAgilDownload: 'https://servicios-compra-agil.mercadopublico.cl/v1/compra-agil/proveedor/cotizacion/descargarAdjunto/',
  licitacionVoucherBase: 'https://www.mercadopublico.cl/bid/modules/bid/voucherview.aspx?enc=',
  probeUrl: 'https://www.mercadopublico.cl/Portal/Modules/Site/Adquisiciones/'
};

/**
 * Descarga un archivo protegido de Compra Ágil y lo retorna como Data URL Base64 en memoria.
 */
async function downloadFileAsBase64(fileId, token) {
  const url = `${ENDPOINTS.compraAgilDownload}${encodeURIComponent(fileId)}`;
  const response = await fetch(url, {
    headers: { Authorization: token }
  });
  if (!response.ok) {
    throw new Error(`Fallo HTTP ${response.status} al descargar archivo ${fileId}`);
  }
  const blob = await response.blob();
  const mimeType = blob.type || 'application/octet-stream';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve({
        dataUrl: reader.result,
        mimeType,
        size: blob.size
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Valida la existencia de una sesión activa de Mercado Público.
 */
export async function checkMpSession() {
  try {
    // 1. Verificación instantánea por cookies (0 ms, sin llamadas de red)
    if (typeof chrome !== "undefined" && chrome.cookies) {
      const cookies = await chrome.cookies.getAll({ domain: "mercadopublico.cl" });
      const hasSession = cookies.some(c => 
        c.name.includes("ASP.NET_SessionId") || 
        c.name.toLowerCase().includes("ticket") || 
        c.name.toLowerCase().includes("token") ||
        c.name.includes(".ASPXAUTH")
      );
      if (hasSession) return true;
    }
    // 2. Respaldo por fetch a la URL real del menú
    const response = await fetch("https://www.mercadopublico.cl/Portal/Modules/Menu/Menu.aspx", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    return response.ok && !response.url.includes("login") && !response.url.includes("claveunica");
  } catch (err) {
    console.warn("[Bridge BG] Error al verificar sesión MP:", err);
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
 * Obtiene el token de autenticación desde memoria o chrome.storage.local.
 */
async function getStoredOrCookieToken() {
  if (cachedAuthToken) return cachedAuthToken;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await new Promise((resolve) => {
        chrome.storage.local.get(['mpAuthToken'], resolve);
      });
      if (res?.mpAuthToken) {
        cachedAuthToken = res.mpAuthToken;
        sessionCache = { hasSession: true, timestamp: Date.now() };
        return cachedAuthToken;
      }
    }
  } catch (e) {
    console.warn('[Bridge BG] Error al buscar token en storage:', e);
  }
  return null;
}

/**
 * Procesa la extracción completa de un proceso y sus ofertas con adjuntos.
 */
async function handleFetchProcess(payload) {
  const hasMpSession = await checkMpSession();
  if (!hasMpSession) {
    return {
      type: 'MP_SOYKODA_RESULT',
      payload: {
        ok: false,
        error: {
          code: 'NO_SESSION',
          message: 'No hay una sesión activa de Mercado Público. Inicia sesión con ClaveÚnica.'
        }
      }
    };
  }

  const codigo = payload?.codigo || '';
  const tipo = payload?.tipo || 'AG';

  try {
    // ── Compra Ágil (AG / CO) ──
    if (tipo === 'AG' || tipo === 'CO' || codigo.toUpperCase().includes('-AG') || codigo.toUpperCase().includes('-COT')) {
      const token = await getStoredOrCookieToken();
      if (!token) {
        return {
          type: 'MP_SOYKODA_RESULT',
          payload: {
            ok: false,
            error: {
              code: 'NO_SESSION',
              message: 'No se detectó el token de sesión de Compra Ágil. Por favor abre una cotización en Mercado Público con tu sesión activa.'
            }
          }
        };
      }

      const url = `${ENDPOINTS.compraAgilSolicitud}${encodeURIComponent(codigo)}`;
      const res = await fetch(url, {
        headers: { Authorization: token }
      });

      if (res.status === 404) {
        return {
          type: 'MP_SOYKODA_RESULT',
          payload: { ok: false, error: { code: 'NOT_FOUND', message: `Cotización ${codigo} no encontrada.` } }
        };
      }
      if (!res.ok) {
        throw new Error(`Error HTTP ${res.status} al consultar cotización en Mercado Público.`);
      }

      const json = await res.json();
      const raw = json.payload || json;

      // Desglose de ofertas
      const rawOfertas = raw.ofertas || raw.proveedores_cotizando || [];
      const ofertas = [];

      for (const of of rawOfertas) {
        const offerId = of.id || of.id_cotizacion || of.idCotizacion;
        let docs = of.documentosAdjuntos || of.documentos || [];
        if ((!docs || docs.length === 0) && offerId) {
          try {
            const detRes = await fetch(`${ENDPOINTS.compraAgilDetails}${encodeURIComponent(offerId)}`, {
              headers: { Authorization: token }
            });
            if (detRes.ok) {
              const detJson = await detRes.json();
              docs = detJson?.payload?.documentosAdjuntos || detJson?.payload?.documentos || [];
            }
          } catch (err) {
            console.warn('[Bridge BG] Error al obtener adjuntos de oferta', offerId, err);
          }
        }

        const isEmt = of.es_emt === 1 || of.es_emt === true || of.esEmt === true;
        const noEmt = of.es_emt === 0 || of.es_emt === false || of.esEmt === false;

        ofertas.push({
          id: offerId,
          rut: of.rutProveedor || of.rut_proveedor || of.rut || '',
          razonSocial: of.razonSocial || of.razon_social || of.nombreProveedor || of.nombre_proveedor || `Proveedor_${offerId}`,
          montoTotal: of.montoTotal || of.monto_total || of.total || 0,
          montoNeto: of.montoNeto || of.valor_neto || of.neto || 0,
          plazoEntrega: of.plazoEntrega || of.plazo_entrega || of.diasEntrega || null,
          observacion: of.observacion || of.descripcion || of.descripcion_cotizacion || of.comentario || '',
          empresaMenorTamano: isEmt ? 'Sí' : noEmt ? 'No' : undefined,
          fechaEnvio: of.fechaEnvio || of.fecha_creacion || of.fechaCreacion || '',
          documentos: (docs || []).map((d) => ({
            id: d.id,
            filename: d.filename || d.nombreArchivo || d.nombre || 'archivo.pdf',
            size: d.size || d.tamano || 0,
            tipo: d.tipo || d.tipoDocumento || 'adjunto'
          }))
        });
      }

      // Adjuntos de las bases o solicitud
      const basesAdjuntos = (raw.documentosAdjuntos || raw.documentos || raw.archivos || []).map((b) => ({
        id: b.id,
        filename: b.filename || b.nombreArchivo || b.nombre || 'bases.pdf',
        size: b.size || b.tamano || 0
      }));

      const safeData = sanitizeDataPayload({
        codigo,
        tipo: 'AG',
        nombre: raw.nombre || raw.descripcion || `Compra Ágil ${codigo}`,
        organismo: raw.organismo || raw.institucion?.organismo_comprador || raw.nombreOrganismo || raw.unidadCompra || '',
        montoEstimado: raw.montoEstimado || raw.presupuesto?.monto_disponible || raw.presupuesto?.presupuesto_estimado || raw.montoTotal || null,
        tipoPresupuesto: raw.tipoPresupuesto || raw.presupuesto?.tipo_presupuesto || 'Disponible',
        plazoEntrega: raw.plazoEntrega || (raw.entrega?.plazo_entrega_dias ? `${raw.entrega.plazo_entrega_dias} días hábiles` : null),
        estado: raw.estado?.glosa || raw.estado || '',
        fechaCierre: raw.fechaCierre || raw.fechas?.fecha_cierre || '',
        basesAdjuntos,
        ofertas
      });

      return {
        type: 'MP_SOYKODA_RESULT',
        payload: {
          ok: true,
          data: safeData
        }
      };
    }

    // ── Licitaciones (LP / LE) con voucher enc ──
    const enc = payload?.enc || '';
    if (enc) {
      const voucherUrl = `${ENDPOINTS.licitacionVoucherBase}${encodeURIComponent(enc)}`;
      const res = await fetch(voucherUrl, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const parsed = await parseHtmlOffscreen(html, 'voucher');
      return {
        type: 'MP_SOYKODA_RESULT',
        payload: {
          ok: true,
          data: sanitizeDataPayload({
            codigo,
            tipo: 'LP',
            archivos: parsed.files || [],
            paginas: parsed.totalPages || 1
          })
        }
      };
    }

    return {
      type: 'MP_SOYKODA_RESULT',
      payload: {
        ok: false,
        error: { code: 'NOT_SUPPORTED', message: `Tipo de proceso ${tipo} requiere parámetro enc para consultar comprobante.` }
      }
    };
  } catch (err) {
    console.error('[Bridge BG] Error en handleFetchProcess:', err);
    return {
      type: 'MP_SOYKODA_RESULT',
      payload: {
        ok: false,
        error: { code: 'FETCH_FAILED', message: err instanceof Error ? err.message : 'Error al consultar proceso.' }
      }
    };
  }
}

/**
 * Descarga un archivo protegido de Mercado Público en memoria como Data URL Base64.
 */
async function handleDownloadFileBase64(payload) {
  const hasMpSession = await checkMpSession();
  if (!hasMpSession) {
    return {
      type: 'MP_SOYKODA_RESULT',
      payload: {
        ok: false,
        error: { code: 'NO_SESSION', message: 'Sesión expirada en Mercado Público.' }
      }
    };
  }

  const fileId = payload?.fileId;
  const filename = payload?.filename || 'archivo.bin';
  const tipo = payload?.tipo || 'AG';

  if (!fileId) {
    return {
      type: 'MP_SOYKODA_RESULT',
      payload: { ok: false, error: { code: 'INVALID_ARGS', message: 'Falta fileId para la descarga.' } }
    };
  }

  try {
    const token = await getStoredOrCookieToken();
    if (!token && (tipo === 'AG' || tipo === 'CO')) {
      return {
        type: 'MP_SOYKODA_RESULT',
        payload: { ok: false, error: { code: 'NO_SESSION', message: 'No hay token de sesión para Compra Ágil.' } }
      };
    }

    const res = await downloadFileAsBase64(fileId, token);
    return {
      type: 'MP_SOYKODA_RESULT',
      payload: {
        ok: true,
        data: {
          fileId,
          filename,
          mime: res.mimeType,
          base64: res.dataUrl,
          size: res.size
        }
      }
    };
  } catch (err) {
    console.error('[Bridge BG] Error en handleDownloadFileBase64:', err);
    return {
      type: 'MP_SOYKODA_RESULT',
      payload: {
        ok: false,
        error: { code: 'FETCH_FAILED', message: err instanceof Error ? err.message : 'Error al descargar archivo en memoria.' }
      }
    };
  }
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

    if (action === 'fetch_process') {
      return handleFetchProcess(payload);
    }

    if (action === 'download_file_base64') {
      return handleDownloadFileBase64(payload);
    }

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

  // 3. Fetch completo de proceso y ofertas (Compra Ágil / Licitación)
  if (type === 'MP_SOYKODA_FETCH_PROCESS') {
    return handleFetchProcess(payload);
  }

  // 4. Descarga de archivo protegido en memoria como Base64 (sin guardar en disco del usuario)
  if (type === 'MP_SOYKODA_DOWNLOAD_FILE_BASE64') {
    return handleDownloadFileBase64(payload);
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
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ mpAuthToken: request.token });
      }
      sendResponse({ success: true });
      return false;
    }
  });

  console.log('[Bridge BG] Módulo SoyKoda Bridge inicializado.');
}
