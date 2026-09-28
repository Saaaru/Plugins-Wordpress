// --- START OF FILE highlight_offers.js (Versión 4 - Auto Reject y UI) ---

// Resaltador de ofertas según presupuesto & Auto Rechazo
console.log(">>> highlight_offers.js (v4) cargado correctamente");

(function () {
    'use strict';

    // Detección de navegador para logging específico
    const isEdge = navigator.userAgent.includes('Edg');
    const isChrome = navigator.userAgent.includes('Chrome') && !isEdge;
    console.log(`[Highlight/AutoReject] Ejecutando en: ${isEdge ? 'Edge' : isChrome ? 'Chrome' : 'Otro navegador'}`);

    // Función para limpiar texto y obtener solo números (sin cambios)
    function cleanCurrency(text) {
        if (!text) return 0;
        return parseInt(text.replace(/\D/g, ''), 10);
    }

    // Función para encontrar un elemento por su texto (sin cambios)
    function findElementByText(text) {
        const elements = document.querySelectorAll('p, span, div, dt, dd');
        return Array.from(elements).find(el => el.textContent.trim() === text);
    }

    let lastLoggedBudget = null;

    // --- FUNCIÓN CLAVE MEJORADA Y CORREGIDA ---
    // Obtiene la información de presupuesto y tipo
    function getBudgetInfo() {
        const budgetLabel = findElementByText('Presupuesto estimado');
        const typeLabel = findElementByText('Tipo de presupuesto');

        if (!budgetLabel || !typeLabel) {
            console.warn("No se encontraron las etiquetas de presupuesto y/o tipo.");
            return null;
        }

        const budgetContainer = budgetLabel.closest('.MuiGrid-container');
        const typeContainer = typeLabel.closest('.MuiGrid-container');

        if (!budgetContainer || !typeContainer) {
            console.warn("No se encontraron los contenedores principales de presupuesto.");
            return null;
        }

        // --- LÓGICA CORREGIDA AQUÍ ---

        // Para el valor del presupuesto, la búsqueda del '$' sigue siendo la mejor opción.
        const valueElement = Array.from(budgetContainer.querySelectorAll('p')).find(p => p.textContent.includes('$'));

        // Para el valor del tipo, la lógica anterior era incorrecta.
        // NUEVA ESTRATEGIA: La etiqueta 'Tipo de presupuesto' está en un div. El valor ('Disponible')
        // está en el siguiente div hermano. Vamos a usar esa relación.
        const typeLabelParentDiv = typeLabel.closest('.MuiGrid-item');
        let typeElement = null;
        if (typeLabelParentDiv && typeLabelParentDiv.nextElementSibling) {
            // El valor está en un <p> dentro del siguiente div hermano.
            typeElement = typeLabelParentDiv.nextElementSibling.querySelector('p');
        }

        if (!valueElement || !typeElement) {
            console.warn("No se encontraron los elementos de valor dentro de los contenedores. Revisando estructura.");
            console.log("valueElement encontrado:", valueElement);
            console.log("typeElement encontrado:", typeElement);
            return null;
        }

        const amount = cleanCurrency(valueElement.textContent);
        const type = typeElement.textContent.trim();

        const budgetKey = `${amount}_${type}`;
        if (lastLoggedBudget !== budgetKey) {
            console.log(`Presupuesto detectado: ${amount} (${type})`);
            lastLoggedBudget = budgetKey;
        }

        return { amount, type };
    }

    // --- FUNCIÓN CLAVE MEJORADA ---
    // Resalta las ofertas que superan el presupuesto
    function highlightOffers(budget) {
        // La estrategia de buscar el precio primero sigue siendo la mejor.
        const priceElements = Array.from(document.querySelectorAll('h3')).filter(h3 => h3.textContent.includes('$'));

        priceElements.forEach(priceEl => {
            // NUEVA ESTRATEGIA para encontrar la tarjeta:
            // El 'h3' con el precio está dentro de un item de grid. La tarjeta completa que contiene
            // tanto el precio como los botones de acción es el ancestro 'MuiPaper-root'.
            const card = priceEl.closest('.MuiPaper-root');

            if (!card || card.dataset.highlighted) return;

            const offerAmount = cleanCurrency(priceEl.textContent);
            if (isNaN(offerAmount)) return;

            let shouldMark = false;
            let bgColor = '', borderColor = '', note = '';

            if (budget.type === 'Disponible') {
                if (offerAmount > budget.amount) {
                    shouldMark = true;
                    bgColor = 'rgba(255, 0, 0, 0.08)';
                    borderColor = 'rgba(255, 0, 0, 0.4)';
                    note = '🔴 OJO: Oferta sobrepasa el disponible';
                }
            } else if (budget.type === 'Estimado') {
                const limit = budget.amount * 1.3;
                if (offerAmount > limit) {
                    shouldMark = true;
                    bgColor = 'rgba(255, 193, 7, 0.1)';
                    borderColor = 'rgba(255, 193, 7, 0.5)';
                    note = '🟡 OJO: Supera el 30% del presupuesto estimado';
                }
            }

            if (shouldMark) {
                card.style.backgroundColor = bgColor;
                card.style.border = `2px solid ${borderColor}`;
                card.style.borderRadius = '8px';
                card.style.padding = '10px';
                card.style.transition = 'all 0.3s ease';

                if (!card.querySelector('.budget-note')) {
                    const noteEl = document.createElement('p');
                    noteEl.className = 'budget-note';
                    noteEl.textContent = note;
                    noteEl.style.fontSize = '13px';
                    noteEl.style.fontWeight = 'bold';
                    noteEl.style.color = borderColor;
                    noteEl.style.fontStyle = 'italic';
                    noteEl.style.margin = '8px 0 0';
                    noteEl.style.textAlign = 'right';

                    // Insertamos la nota después del contenedor del precio y su etiqueta
                    const targetContainer = priceEl.parentElement.parentElement.parentElement;
                    targetContainer.appendChild(noteEl);

                    // --- NUEVA LÓGICA DE AUTO-RECHAZO ---
                    // Verificar si ya está rechazada (tiene un span o div que dice INADMISIBLE)
                    const isAlreadyRejected = Array.from(card.querySelectorAll('span, div')).some(el => {
                        return el && el.textContent && el.textContent.trim() === 'INADMISIBLE';
                    });

                    // Solo inyectar el botón si excedió el disponible (Rojo) y NO ha sido rechazada aún
                    if (budget.type === 'Disponible' && offerAmount > budget.amount && !isAlreadyRejected) {
                        const rejectBtn = document.createElement('button');
                        rejectBtn.textContent = '🤖 Auto-Rechazar';
                        Object.assign(rejectBtn.style, {
                            marginTop: '5px',
                            padding: '4px 8px',
                            fontSize: '11px',
                            backgroundColor: '#d32f2f',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            float: 'right'
                        });

                        rejectBtn.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            startAutoRejectFlow(card, rejectBtn);
                        };

                        targetContainer.appendChild(rejectBtn);
                    }
                }
            }
            card.dataset.highlighted = 'true';
        });
    }

    // Función auxiliar para emitir clicks en React
    function reactClick(element) {
        if (!element) return;
        ['mousedown', 'mouseup', 'click'].forEach(eventType => {
            const event = new MouseEvent(eventType, {
                view: window,
                bubbles: true,
                cancelable: true,
                buttons: 1
            });
            element.dispatchEvent(event);
        });
    }

    // --- FLUJO DE AUTO RECHAZO ---
    async function startAutoRejectFlow(offerCard, rejectBtn) {
        try {
            // STEP 1: Click "Declarar inadmisible" on the item
            const clickableTargets = Array.from(offerCard.querySelectorAll('a, button, span'));
            const inadmisibleBtn = clickableTargets.find(el => el.textContent && el.textContent.includes('Declarar inadmisible'));

            if (!inadmisibleBtn) {
                alert("No se encontró el botón de declarar inadmisible en esta oferta.");
                return;
            }
            console.log("[AutoReject] Abriendo modal 1...");
            reactClick(inadmisibleBtn);

            // STEP 2: Wait for modal 1 and click radio #2
            console.log("[AutoReject] Esperando modal de opciones...");
            const radioOption = await waitForElement('input[type="radio"][value="2"]');
            if (radioOption) {
                reactClick(radioOption);
                // Forzar el evento 'change' por siacaso
                radioOption.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // STEP 3: Click "Declarar inadmisible" in modal 1
            await new Promise(r => setTimeout(r, 600));
            let modal1Btns = Array.from(document.querySelectorAll('button'));
            let confirmBtn1 = modal1Btns.find(btn => btn.textContent === 'Declarar inadmisible');
            if (confirmBtn1) reactClick(confirmBtn1);

            // STEP 4: Wait for modal 2 confirmation text
            console.log("[AutoReject] Esperando confirmación irreversible...");
            await waitForElement('h4', 'Estás a punto de');

            // STEP 5: Click "Continuar y declarar..."
            await new Promise(r => setTimeout(r, 600));
            let modal2Btns = Array.from(document.querySelectorAll('button'));
            let confirmBtn2 = modal2Btns.find(btn => btn.textContent && btn.textContent.includes('Continuar y declarar'));
            if (confirmBtn2) reactClick(confirmBtn2);

            console.log("[AutoReject] ¡Oferta descartada automáticamente!");
            if (rejectBtn) rejectBtn.remove();
        } catch (error) {
            console.error("[AutoReject] Error en el flujo automatizado:", error);
            alert("Ocurrió un error en la automatización. Por favor intente manualmente.");
        }
    }

    // Helper to wait for elements to appear in the DOM
    function waitForElement(selector, textContent = null, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const check = () => {
                const elements = Array.from(document.querySelectorAll(selector));
                let found = null;

                if (textContent) {
                    found = elements.find(el => el.textContent.includes(textContent));
                } else {
                    found = elements[0];
                }

                if (found) {
                    resolve(found);
                    return true;
                }
                return false;
            };

            if (check()) return;

            const observer = new MutationObserver(() => {
                if (check()) {
                    observer.disconnect();
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timeout waiting for ${selector}`));
            }, timeout);
        });
    }

    // El resto del script (runHighlighter y MutationObserver) no necesita cambios.
    let debounceTimer = null;

    function runHighlighter() {
        const budget = getBudgetInfo();
        if (!budget) {
            return;
        }
        highlightOffers(budget);
    }

    const observer = new MutationObserver(() => {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
            const bodyText = document.body.textContent || '';
            const budgetInfoExists = bodyText.includes('Presupuesto estimado');
            const offersExist = bodyText.includes('Monto total');

            if (budgetInfoExists && offersExist) {
                // Solo ejecutar si hay tarjetas con precios sin procesar
                const unhighlightedCards = Array.from(document.querySelectorAll('h3'))
                    .filter(h3 => h3.textContent.includes('$'))
                    .map(h3 => h3.closest('.MuiPaper-root'))
                    .filter(card => card && !card.dataset.highlighted);

                if (unhighlightedCards.length > 0) {
                    console.log(`Contenido detectado (${unhighlightedCards.length} oferta(s) por procesar). Ejecutando resaltador...`);
                    runHighlighter();
                }
            }
        }, 350);
    });

    console.log("Iniciando MutationObserver para esperar el contenido dinámico...");
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();