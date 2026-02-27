// --- START OF FILE bulk_editor.js ---

(function () {
    'use strict';

    console.log(">>> Carga Masiva (v5 - Descarga Directa) cargado.");

    // --- 1. UTILIDADES ---

    // Simula un clic humano completo
    function simulateMouseClick(element) {
        const events = ['mousedown', 'mouseup', 'click'];
        events.forEach(eventType => {
            const mouseEvent = new MouseEvent(eventType, {
                bubbles: true,
                cancelable: true,
                view: window,
                buttons: 1
            });
            element.dispatchEvent(mouseEvent);
        });
    }

    // Escribe en inputs de React
    function setReactInputValue(element, value) {
        if (!element) return;
        
        const lastValue = element.value;
        element.value = value;
        
        const tracker = element._valueTracker;
        if (tracker) {
            tracker.setValue(lastValue);
        }
        
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    const delay = ms => new Promise(res => setTimeout(res, ms));

    // Selecciona opción del Dropdown Material UI
    async function selectMuiDropdown(containerCard, textToFind) {
        if (!textToFind) return;

        const trigger = containerCard.querySelector('[role="combobox"]');
        if (!trigger) return;

        trigger.scrollIntoView({ behavior: 'auto', block: 'center' });
        
        simulateMouseClick(trigger);
        await delay(800); 

        const options = document.querySelectorAll('li[role="option"]');
        const search = textToFind.trim().toUpperCase();
        
        let found = null;
        for (const op of options) {
            const opText = op.textContent || "";
            const titleText = op.querySelector('div')?.getAttribute('title') || ""; 
            
            if (opText.toUpperCase() === search || titleText.toUpperCase() === search) {
                found = op;
                break;
            }
        }

        if (found) {
            simulateMouseClick(found);
            console.log(`✅ [Unidad] Click real en: ${textToFind}`);
        } else {
            console.warn(`⚠️ [Unidad] No encontrada: ${textToFind}`);
            const backdrop = document.querySelector('.MuiPopover-root div[aria-hidden="true"]'); 
            if (backdrop) simulateMouseClick(backdrop);
            else document.body.click();
        }

        await delay(400); 
    }


    // --- 2. LÓGICA PRINCIPAL ---

    async function processBulkData(textData) {
        const lines = textData.trim().split('\n');
        
        const productCards = Array.from(document.querySelectorAll('.MuiPaper-root')).filter(card => {
            return card.querySelector('input[type="number"]') && card.querySelector('[role="combobox"]');
        });

        if (productCards.length === 0) {
            alert("❌ No encontré tarjetas. Agrega líneas vacías primero.");
            return;
        }

        console.log(`📋 Procesando ${lines.length} líneas en ${productCards.length} tarjetas.`);

        let processedCount = 0;

        for (let i = 0; i < lines.length; i++) {
            if (i >= productCards.length) break;

            const line = lines[i].trim();
            if (!line) continue;

            let parts = line.split(/\t/); 
            if (parts.length < 2 && line.includes(';')) parts = line.split(';');

            const cantidad = parts[0]?.trim();
            const unidad = parts[1]?.trim();
            const detalle = parts[2]?.trim(); 

            const card = productCards[i];

            // A. Cantidad
            if (cantidad) {
                const inputQty = card.querySelector('input[type="number"]');
                if (inputQty) setReactInputValue(inputQty, cantidad);
            }

            // B. Detalle
            if (detalle) {
                const textAreas = Array.from(card.querySelectorAll('textarea'));
                const inputDetail = textAreas.find(t => t.getAttribute('aria-hidden') !== 'true') || textAreas[0];
                if (inputDetail) {
                    setReactInputValue(inputDetail, detalle);
                }
            }

            // C. Unidad
            if (unidad) {
                await selectMuiDropdown(card, unidad);
            }
            
            processedCount++;
        }

        alert(`✅ Listo. ${processedCount} items procesados.`);
    }


    // --- 3. INTERFAZ GRÁFICA ---

    function createUI() {
        if (document.getElementById('mp-bulk-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'mp-bulk-btn';
        btn.innerHTML = '📋 Carga Masiva';
        Object.assign(btn.style, {
            position: 'fixed', top: '15px', right: '20px', zIndex: '9999',
            padding: '12px 24px', backgroundColor: '#00549f', color: 'white',
            border: 'none', borderRadius: '50px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            cursor: 'pointer', fontSize: '14px', fontWeight: 'bold',
            transition: 'all 0.3s ease'
        });
        
        btn.onmouseover = () => btn.style.transform = "scale(1.05)";
        btn.onmouseout = () => btn.style.transform = "scale(1)";

        btn.onclick = showModal;
        document.body.appendChild(btn);
    }

    function showModal() {
        if (document.getElementById('mp-bulk-modal')) return;

        const overlay = document.createElement('div');
        overlay.id = 'mp-bulk-modal';
        Object.assign(overlay.style, {
            position: 'fixed', 
            top: 0, 
            left: 0, 
            width: '100%', 
            height: '100%',
            backgroundColor: 'rgba(0,0,0,0.6)', 
            zIndex: '10000', 
            backdropFilter: 'blur(2px)',
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'flex-start', 
            paddingTop: '100px'
        });

        const container = document.createElement('div');
        Object.assign(container.style, {
            backgroundColor: 'white', padding: '25px', borderRadius: '12px',
            width: '500px', boxShadow: '0 20px 40px rgba(0,0,0,0.3)', fontFamily: 'sans-serif'
        });

        // Link modificado para descarga directa
        const downloadUrl = "https://drive.google.com/uc?export=download&id=1QXkR-q54B1qgtSfiwSeYD1JiDQXz3G9t";

        container.innerHTML = `
            <h2 style="margin-top:0; color:#333;">Carga Masiva Excel</h2>
            
            <div style="background-color: #e3f2fd; padding: 15px; border-radius: 8px; margin-bottom: 15px; border-left: 5px solid #2196f3;">
                <p style="margin: 0 0 10px 0; font-size: 14px; color: #0d47a1;">
                    <strong>Instrucciones:</strong><br>
                    1. Descarga la plantilla.<br>
                    2. Copia las celdas del Excel (incluyendo columnas vacías si aplica).<br>
                    3. Pégalas en el cuadro de abajo.
                </p>
                <a href="${downloadUrl}" 
                   style="display: inline-flex; align-items: center; background-color: #fff; padding: 8px 12px; border-radius: 4px; color: #00549f; text-decoration: none; font-size: 13px; font-weight: bold; border: 1px solid #bbdefb;">
                   📥 Descargar Plantilla Excel
                </a>
            </div>

            <textarea id="mp-bulk-data" placeholder="CANTIDAD | FORMATO | DETALLE" style="width:100%; height:200px; padding:10px; border:1px solid #ccc; borderRadius:6px; font-family:monospace;"></textarea>
            
            <div style="margin-top:20px; text-align:right;">
                <button id="mp-bulk-cancel" style="padding:10px 20px; margin-right:10px; border:none; background:transparent; cursor:pointer; color:#666; font-weight:bold;">Cancelar</button>
                <button id="mp-bulk-run" style="padding:10px 24px; border:none; background:#28a745; color:white; border-radius:6px; cursor:pointer; font-weight:bold; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">⚡ Ejecutar Carga</button>
            </div>
        `;

        overlay.appendChild(container);
        document.body.appendChild(overlay);

        document.getElementById('mp-bulk-cancel').onclick = () => overlay.remove();
        document.getElementById('mp-bulk-run').onclick = async () => {
            const data = document.getElementById('mp-bulk-data').value;
            overlay.remove();
            await processBulkData(data);
        };
    }

    setTimeout(createUI, 1500);

})();