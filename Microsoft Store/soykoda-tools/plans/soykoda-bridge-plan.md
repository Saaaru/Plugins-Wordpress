# SoyKoda Bridge — Arquitectura e Implementación Completada

> **Estado**: ✅ **IMPLEMENTADO** (Patrón Content Script Bridge con `window.postMessage` y Offscreen DOMParser).

---

## 1. Decisiones de Arquitectura

1. **Descarte de `externally_connectable`**: Se descartó para evitar acoplar la web a Extension IDs dispares entre Chrome Web Store y Edge Add-ons.
2. **Content Script Bridge (`soykoda_bridge.js`)**: Inyectado en `https://soykoda.cloud/*` y `http://localhost:3000/*` en `document_start`.
   - Marca el DOM con `data-mp-tools="1"` en `document.documentElement`.
   - Valida estrictamente `event.origin` contra la allowlist.
   - Aplica `nonce` criptográfico en cada par solicitud-respuesta.
3. **Línea Roja de Seguridad**:
   - Ni tokens Bearer ni cookies ASP.NET viajan al backend de SoyKoda.
   - Las descargas binarias se realizan en local vía `chrome.downloads`.
4. **Módulo Offscreen (`offscreen.html` + `offscreen.js`)**:
   - Encapsula `DOMParser` dentro del contexto de extensión con permiso `offscreen`.
   - Reutiliza los selectores de `licitaciones_download.js` y `voucher_content.js`.
5. **Persistencia en dos tiempos**:
   - Consumo reactivo en cliente con hook `useMpTools`.
   - Ingesta consentida per-user en PostgreSQL (`extension_snapshots` + `POST /api/extension/ingest`).

---

## 2. Contrato de Mensajería

### Handshake
```typescript
Web -> CS:  { source: 'soykoda-web', type: 'MP_SOYKODA_PING', nonce: string }
CS  -> Web: { source: 'mp-tools',    type: 'MP_SOYKODA_PONG', nonce: string, payload: { version: string, capabilities: string[], hasMpSession: boolean } }
```

### Solicitud y respuesta de datos
```typescript
Web -> CS:  { source: 'soykoda-web', type: 'MP_SOYKODA_FETCH', nonce: string, payload: { codigo: string, tipo: 'OC' | 'LP' | 'CO', action: string, ids?: string[] } }
CS  -> Web: { source: 'mp-tools',    type: 'MP_SOYKODA_RESULT', nonce: string, payload: { ok: true, data: any } | { ok: false, error: { code: 'NO_SESSION' | 'NOT_FOUND' | 'RATE_LIMITED' | 'FETCH_FAILED' } } }
```

---

## 3. Resumen de Archivos Implementados

### Repositorio Extensión KodaTools (`Plugins/Microsoft Store/soykoda-tools/`)
* [`manifest.json`](../manifest.json): Inyección de `soykoda_bridge.js` en `https://soykoda.cloud/*` y `http://localhost:3000/*`, permiso `offscreen`.
* [`soykoda_bridge.js`](../soykoda_bridge.js): Content script con `data-mp-tools="1"`, filtro de origen y relay `window.postMessage` ↔ `chrome.runtime.sendMessage`.
* [`bridge_background.js`](../bridge_background.js): Verificación de sesión (probe ligero `redirect: 'manual'`), gestión de offscreen y respuesta al handshake/fetch.
* [`background.js`](../background.js): Inicialización de `initBridgeHandler()`.
* [`content.js`](../content.js): Reenvío de token interceptado a `background.js`.
* [`offscreen.html`](../offscreen.html) & [`offscreen.js`](../offscreen.js): Parsing de WebForms y grillas de comprobantes de licitación vía `DOMParser`.

### Repositorio SoyKoda Web (`soykoda/`)
* [`src/hooks/use-mp-tools.ts`](../../../../Chatbot-ChileCompra/soykoda/src/hooks/use-mp-tools.ts): Hook reactivo con estados `NOT_INSTALLED`, `SESSION_INACTIVE` y `READY`.
* [`src/components/historico/mp-extension-sync.tsx`](../../../../Chatbot-ChileCompra/soykoda/src/components/historico/mp-extension-sync.tsx): Componente UI para sincronización y feedback.
* [`src/components/historico/detail-modal.tsx`](../../../../Chatbot-ChileCompra/soykoda/src/components/historico/detail-modal.tsx): Integración en la Ficha Técnica de transacciones.
* [`db/migrations/0029_extension_snapshots.sql`](../../../../Chatbot-ChileCompra/soykoda/db/migrations/0029_extension_snapshots.sql): Tabla `extension_snapshots` con constraints únicos por usuario y código.
* [`src/app/api/extension/ingest/route.ts`](../../../../Chatbot-ChileCompra/soykoda/src/app/api/extension/ingest/route.ts): Endpoint de ingesta con Supabase Auth, rate limit y bloqueo estricto de credenciales.
