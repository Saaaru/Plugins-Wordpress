/**
 * offscreen.js — DOMParser encapsulado en un Offscreen Document (MV3).
 *
 * En Manifest V3 los Service Workers no disponen de la API DOMParser ni de window.document.
 * Este script procesa el HTML devuelto por los WebForms legados de Mercado Público
 * (Licitaciones, Órdenes de Compra y Comprobantes de Adquisición/Voucher) y extrae
 * estructuras JSON limpias reutilizando los selectores de licitaciones_download.js y voucher_content.js.
 */

function sanitizeText(str) {
  if (!str) return '';
  return str.replace(/\s+/g, ' ').trim();
}

function sanitizeFilename(name) {
  if (!name) return 'documento';
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    || 'documento';
}

/**
 * Extrae todos los campos ocultos del formulario ASP.NET (__VIEWSTATE, etc.)
 */
function parseFormState(doc) {
  const state = {};
  const hiddenInputs = doc.querySelectorAll('input[type="hidden"]');
  hiddenInputs.forEach((h) => {
    if (h.name) {
      state[h.name] = h.value || '';
    }
  });
  return state;
}

/**
 * Extrae los archivos adjuntos de la grilla de comprobantes de licitación (grdId).
 * Reutiliza la lógica de licitaciones_download.js y voucher_content.js.
 */
function parseVoucherFiles(doc) {
  const grid = doc.querySelector('table[id*="grdId"]') || doc.querySelector('table[id*="grdSupplies"]');
  if (!grid) return [];

  const rows = Array.from(grid.querySelectorAll('tr')).filter((tr) =>
    tr.querySelector('input[type="image"][name*="search"]')
  );

  return rows.map((tr) => {
    const btn = tr.querySelector('input[type="image"][name*="search"]');
    let filename = 'documento';

    const fileSpan = tr.querySelector('span[id$="_File"]') || tr.querySelector('span[id*="_File"]');
    if (fileSpan && fileSpan.textContent.trim()) {
      filename = fileSpan.textContent.trim();
    } else {
      const lines = (tr.textContent || '')
        .split('\n')
        .map((s) => s.trim())
        .filter((l) => l && !/ver\s*anexo/i.test(l) && l.length > 1);
      filename = lines.slice().sort((a, b) => b.length - a.length)[0] || 'documento';
    }

    return {
      buttonName: btn ? btn.name : '',
      filename: sanitizeFilename(filename)
    };
  });
}

/**
 * Determina el total de páginas del pager ASP.NET
 */
function parseTotalPages(doc) {
  let max = 1;
  doc.querySelectorAll('a[href*="Page$"]').forEach((a) => {
    const m = (a.getAttribute('href') || '').match(/Page\$(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n)) max = Math.max(max, n);
    }
  });

  const currentPage = detectCurrentPage(doc);
  if (currentPage !== null) max = Math.max(max, currentPage);
  return max;
}

/**
 * Detecta la página actual a partir del <span> activo en el pager
 */
function detectCurrentPage(doc) {
  const grid = doc.querySelector('table[id*="grdId"]') || doc.querySelector('table[id*="grdSupplies"]');
  if (!grid) return 1;
  const rows = Array.from(grid.querySelectorAll('tr'));
  const pagerRow = rows[rows.length - 1];
  if (!pagerRow) return 1;
  const span = pagerRow.querySelector('span');
  if (span) {
    const n = parseInt((span.textContent || '').trim(), 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return 1;
}

/**
 * Parser genérico para tablas de resumen / pares clave-valor en páginas de Mercado Público
 */
function parseKeyValueTables(doc) {
  const metadata = {};
  const tables = doc.querySelectorAll('table');

  tables.forEach((table) => {
    const rows = table.querySelectorAll('tr');
    rows.forEach((tr) => {
      const cells = tr.querySelectorAll('th, td');
      if (cells.length === 2) {
        const key = sanitizeText(cells[0].textContent);
        const val = sanitizeText(cells[1].textContent);
        if (key && key.length < 80 && val) {
          metadata[key] = val;
        }
      }
    });
  });

  return metadata;
}

/**
 * Parser para items/líneas de la orden de compra o licitación
 */
function parseTableItems(doc) {
  const items = [];
  const candidateTables = doc.querySelectorAll('table[id*="grd"], table[id*="grid"], table.grid, table[id*="Item"]');

  candidateTables.forEach((table) => {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length < 2) return;

    const headerCells = Array.from(rows[0].querySelectorAll('th, td')).map((c) => sanitizeText(c.textContent));
    if (headerCells.length === 0) return;

    for (let i = 1; i < rows.length; i++) {
      const cells = Array.from(rows[i].querySelectorAll('td')).map((c) => sanitizeText(c.textContent));
      if (cells.length === headerCells.length) {
        const item = {};
        headerCells.forEach((hdr, idx) => {
          if (hdr) item[hdr] = cells[idx];
        });
        items.push(item);
      }
    }
  });

  return items;
}

// ── Listener de mensajes del Service Worker ───────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== 'OFFSCREEN_PARSE') {
    return;
  }

  try {
    const html = request.html || '';
    const parserType = request.parserType || 'voucher';
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    if (parserType === 'voucher') {
      const formState = parseFormState(doc);
      const files = parseVoucherFiles(doc);
      const totalPages = parseTotalPages(doc);
      const currentPage = detectCurrentPage(doc);

      sendResponse({
        ok: true,
        data: {
          tipo: 'VOUCHER',
          formState,
          files,
          totalPages,
          currentPage
        }
      });
      return true;
    }

    if (parserType === 'orden_compra' || parserType === 'licitacion') {
      const metadata = parseKeyValueTables(doc);
      const items = parseTableItems(doc);
      const files = parseVoucherFiles(doc);

      sendResponse({
        ok: true,
        data: {
          tipo: parserType.toUpperCase(),
          metadata,
          items,
          files
        }
      });
      return true;
    }

    // Default parser
    const metadata = parseKeyValueTables(doc);
    const files = parseVoucherFiles(doc);
    sendResponse({
      ok: true,
      data: {
        tipo: 'GENERIC',
        metadata,
        files
      }
    });
    return true;
  } catch (err) {
    console.error('[Offscreen Parser] Error:', err);
    sendResponse({
      ok: false,
      error: {
        code: 'PARSE_FAILED',
        message: err instanceof Error ? err.message : 'Error al parsear documento HTML.'
      }
    });
    return true;
  }
});

console.log('[KodaTools Offscreen] DOM Parser offscreen document listo.');
