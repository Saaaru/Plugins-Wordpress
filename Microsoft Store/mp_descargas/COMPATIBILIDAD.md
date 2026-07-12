# 🌐 Revisión de Compatibilidad — Chrome vs Edge

**Extensión:** MP Tools para Mercado Público · **Versión:** 4.4.0 · **Manifest:** V3

## ✅ Veredicto

> **La extensión es 100 % compatible con Google Chrome y Microsoft Edge.**
> No se requiere ningún cambio de código ni bifurcación (`fork`) para publicar en ambas tiendas. El mismo paquete `.zip` funciona idénticamente en ambos navegadores.

### ¿Por qué?

Tanto Chrome como Edge están construidos sobre **Chromium** y comparten el mismo modelo de extensiones (APIs `chrome.*`, Manifest V3, Service Workers). Edge soporta de forma nativa las Chrome Extensions; de hecho, la Microsoft Edge Add-ons store acepta los mismos paquetes que la Chrome Web Store.

---

## 🔍 Análisis API por API (extraído de `manifest.json` y los scripts)

| Elemento usado | Chrome | Edge | Notas |
| :--- | :---: | :---: | :--- |
| `manifest_version: 3` | ✅ | ✅ | Estándar actual en ambos navegadores. |
| `action` con `default_popup` (`popup.html`) | ✅ | ✅ | API de toolbar estándar. |
| `background.service_worker` con `"type": "module"` | ✅ | ✅ | Service Worker ES module soportado en ambos MV3. Edge soporta `import`/`export` en el SW igual que Chrome. |
| `import { initVoucherHandler } from './voucher_background.js'` | ✅ | ✅ | Import dinámico de ES module en el SW; soportado. |
| `content_scripts` con `"all_frames": true` | ✅ | ✅ | Inyección en todos los frames del mismo origen. |
| `web_accessible_resources` (MV3, formato de array de objetos) | ✅ | ✅ | Sintaxis V3 estándar para `api_interceptor.js`. |
| Permiso `downloads` + `chrome.downloads.download()` | ✅ | ✅ | Descarga directa sin diálogo. Implementación idéntica en Chromium. |
| Permiso `scripting` + `chrome.scripting.executeScript({ allFrames: true })` | ✅ | ✅ | Inyección programática en todos los frames desde el popup. Soportado en Edge MV3. |
| `chrome.runtime.onMessage` / `sendMessage` | ✅ | ✅ | Paso de mensajes estándar. |
| `chrome.tabs.query` / `chrome.tabs.sendMessage` | ✅ | ✅ | Estándar. |
| `host_permissions: https://*.mercadopublico.cl/*` | ✅ | ✅ | Permisos de host; en Edge se conceden igual que en Chrome. `credentials: 'include'` usa las cookies de sesión del navegador. |
| `window.postMessage` (interceptor ↔ content script) | ✅ | ✅ | Web API estándar, ajena a la extensión. |
| `fetch` / `XMLHttpRequest` hooks + `FileReader` (blob→base64) | ✅ | ✅ | Web APIs estándar de Chromium. |
| `MutationObserver`, `DOMParser`, `URLSearchParams` | ✅ | ✅ | Web APIs estándar. |
| `sessionStorage` (reanudación de paginación Voucher) | ✅ | ✅ | Web Storage estándar. |

---

## ⚠️ Puntos a verificar en la práctica (no bloqueantes)

1. **Modo desarrollador / carga descomprimida:** idéntico en ambos (`chrome://extensions/` y `edge://extensions/`). ✅
2. **Permisos de sitio (Edge):** Edge puede pedir confirmación para ejecutar la extensión en sitios específicos; el permiso `scripting` + `host_permissions` ya está declarado, así que el flujo de concesión es el mismo que en Chrome.
3. **Política de tiendas:** la Chrome Web Store y Microsoft Edge Add-ons tienen procesos de revisión separados, pero el paquete (código + `manifest.json` + iconos) es el mismo. No hay diferencias de código.
4. **Comentario en `licitaciones_download.js`** que menciona *"si Edge lo permite"* respecto a la inyección por manifest con `all_frames`: en la práctica Edge **sí** lo permite (es Chromium MV3). Además, el **camino principal** de inyección es el popup con `chrome.scripting.executeScript({ allFrames: true })`, que es 100 % confiable en ambos navegadores. No hay riesgo real.

---

## 🧪 Recomendación de prueba

Antes de cada release, ejecuta este checklist mínimo en **ambos** navegadores:

- [ ] Cargar la extensión descomprimida en Chrome y en Edge.
- [ ] Abrir una cotización de Compra Ágil: verificar botones `📥 Descargar todo`, `📥 Descargar todas las ofertas` y `📊 Exportar tabla a Excel`.
- [ ] Abrir una Licitación: verificar que los botones `📥` se inyectan automáticamente y descargar adjuntos de un comprobante.
- [ ] Verificar el resaltado de presupuesto y el botón `🤖 Auto-Rechazar`.
- [ ] Probar la carga masiva desde Excel.
- [ ] Confirmar que no hay errores en la consola del Service Worker ni de los content scripts.

---

## 📦 Publicación

- **Chrome Web Store:** https://chrome.google.com/webstore/devconsole (requiere cuenta de desarrollador, tarifa única de USD 5).
- **Microsoft Edge Add-ons:** https://partner.microsoft.com/dashboard/microsoftedge (registro gratuito).

Ambos portales aceptan el mismo `.zip` con la raíz del proyecto (incluyendo `manifest.json`, todos los `.js`, `popup.html` e `icon.png`).

---

*Conclusión: no se detectan incompatibilidades. La extensión es publicable tal cual en ambas tiendas.*
