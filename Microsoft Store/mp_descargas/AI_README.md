# AI-Ready Project Documentation: MP Tools (Mercado Público Downloads & Automation)

This document is designed for AI assistants to quickly understand the architecture, logic, and data flow of this browser extension.

## 📌 Project Overview
**Name:** Descarga Masiva de Adjuntos - Mercado Público (MP Tools)
**Type:** Chrome Extension (Manifest V3)
**Domain:** `https://*.mercadopublico.cl/*` (Specifically targeted at "Compra Ágil")
**Core Purpose:** Automates repetitive tasks in the Chilean government procurement portal, including mass downloading files, bulk data entry from Excel, and budget-based offer analysis.

---

## 🛠 Tech Stack & Environment
- **Framework:** Vanilla JavaScript (ES6+).
- **Extension API:** Manifest V3 (Service Workers, Content Scripts, Web Accessible Resources).
- **Target Site Context:** React-based single-page application (SPA) using Material UI (MUI).
- **Permissions:** `activeTab`, `downloads`, `host_permissions` for `mercadopublico.cl`.

---

## 📂 File Manifest & Role Definition

### 1. `manifest.json`
- Defines entry points: `background.js` (service worker), `content.js`, `highlight_offers.js`, `bulk_editor.js` (content scripts).
- Lists `api_interceptor.js` as a `web_accessible_resource` to allow injection into the main page context.

### 2. `api_interceptor.js` (Injected Script)
- **Context:** Runs in the **Main Page** context (not isolated content script).
- **Mechanism:** Overrides `window.fetch` and `XMLHttpRequest.prototype.open/send`.
- **Function:** 
    - Listens for outgoing requests to specific API patterns (e.g., `/v1/compra-agil/solicitud/`).
    - Captures the `Authorization` bearer token from request headers.
    - Captures JSON responses containing offer details and attachment lists.
    - **Communication:** Sends captured data to the content script using `window.postMessage`.

### 3. `content.js` (The Bridge)
- **Context:** Isolated Content Script.
- **Roles:**
    - Injects `api_interceptor.js` into the document head.
    - Listens for `window.postMessage` from the interceptor.
    - Injects UI elements (buttons) into the Mercado Público DOM.
    - **Download Logic:** Orchestrates mass downloads. For "Download All Offers", it sends data to `background.js`. For "Download This Quotation", it handles the fetches itself via authenticated `fetch` and `blob` generation.

### 4. `background.js` (Service Worker)
- **Role:** Handles high-volume asynchronous tasks that should persist across page navigations.
- **Specific Task:** `handleAllOffersDownload`. 
    - Receives a list of offer IDs and an auth token.
    - Fetches details for each offer to get file IDs.
    - Downloads files using `chrome.downloads.download`.
    - Organizes files into folders: `{Quotation_ID}/{Provider_Name}/{Filename}`.

### 5. `bulk_editor.js` (Automation)
- **Feature:** "Carga Masiva" (Bulk Upload).
- **Mechanism:** 
    - Parses Tab-separated values (TSV) from Excel.
    - Identifies MUI input fields (Number inputs, Comboboxes, Textareas).
    - **Critical Pattern:** Uses `setReactInputValue` which updates the internal React `_valueTracker` to ensure React notices the programmatic change.
    - Simulates human-like mouse clicks for Material UI dropdowns.

### 6. `highlight_offers.js` (Intelligence)
- **Feature:** Budget Highlighting & Auto-Reject.
- **Logic:**
    - Scrapes "Presupuesto estimado" and "Tipo de presupuesto" (Disponible vs Estimado).
    - Compares offer prices (`h3` elements) against thresholds.
    - Colors cards: Red (exceeds budget), Yellow (exceeds 130% of estimated).
    - **Auto-Reject:** Automates the multi-step modal flow for "Declarar inadmisible" using `MutationObserver` and async `waitForElement` logic.

---

## 🔄 Interaction Flows

### Data Flow for Mass Download:
1. **User** loads the "Compra Ágil" page.
2. `api_interceptor.js` captures the `Authorization` token when the page requests offer data.
3. `api_interceptor.js` -> `postMessage({token, ofertas})` -> `content.js`.
4. `content.js` displays the "📥 Descargar todas las ofertas" button.
5. **User** clicks the button.
6. `content.js` -> `chrome.runtime.sendMessage` -> `background.js`.
7. `background.js` iterates through offers, fetches attachment lists, and triggers `chrome.downloads`.

### React Form Manipulation:
To successfully fill forms in this React/MUI app, the scripts follow this pattern:
1. Locate target element (e.g., `input`).
2. Update `.value` property.
3. Manually trigger `input`, `change`, and `blur` events.
4. Access `element._valueTracker` and call `.setValue(lastValue)` to force React state sync.

---

## 📍 Selective Selectors & Patterns
- **Cards:** `.MuiPaper-root`
- **Prices:** `h3` containing `$`
- **Buttons:** Text-based search (e.g., "Declarar inadmisible", "Continuar y declarar")
- **Quotation ID:** Regex extraction from `h2` elements: `\d+-\d+-[A-Z0-9]+`

## ⚠️ Important Considerations for Development
- **Race Conditions:** The page is dynamic. Most scripts use `MutationObserver` or `setTimeout` to ensure elements are present before acting.
- **Rate Limiting:** `background.js` implements a ~500ms delay between download triggers to avoid browser/OS congestion.
- **Filename Sanitization:** Files are sanitized for Windows/Unix compatibility via regex `/[<>:"/\\|?*\x00-\x1F]/g`.
