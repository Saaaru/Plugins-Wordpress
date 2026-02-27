let currentFileUrl = '';
let currentFormSource = null;
let downloadTriggered = false; // Para evitar descargas dobles

function srlOpenModal(btn) {
    const modal = document.getElementById('srlModal');
    const nameSpan = document.getElementById('srlResourceName');
    const modalContent = document.getElementById('srlModalContent');

    // 1. Datos
    const title = btn.getAttribute('data-title');
    currentFileUrl = btn.getAttribute('data-file-url');
    const formSourceId = btn.getAttribute('data-form-source');

    downloadTriggered = false; // Resetear bandera

    if (nameSpan) nameSpan.textContent = title;

    // 2. Mover Formulario
    // Limpiar anterior
    if (modalContent.children.length > 0 && currentFormSource) {
        while (modalContent.firstChild) {
            currentFormSource.appendChild(modalContent.firstChild);
        }
    }

    // Traer nuevo
    const sourceContainer = document.getElementById(formSourceId);
    if (sourceContainer) {
        currentFormSource = sourceContainer;

        // Limpiar mensajes viejos (éxito o error) para que se vea limpio
        const oldMessages = sourceContainer.querySelectorAll('.mailpoet_success_message_server, .mailpoet_validate_success, .mailpoet_error_message');
        oldMessages.forEach(el => el.style.display = 'none');

        // Asegurar que el form se vea
        const formTag = sourceContainer.querySelector('form');
        if (formTag) {
            formTag.style.display = 'block';
            formTag.style.opacity = '1';
        }

        while (sourceContainer.firstChild) {
            modalContent.appendChild(sourceContainer.firstChild);
        }
    }

    if (modal) modal.classList.add('open');

    // Activar el Vigilante
    srlStartObserver();
}

function srlCloseModal() {
    const modal = document.getElementById('srlModal');
    const modalContent = document.getElementById('srlModalContent');

    if (currentFormSource && modalContent) {
        while (modalContent.firstChild) {
            currentFormSource.appendChild(modalContent.firstChild);
        }
        currentFormSource = null;
    }

    currentFileUrl = '';
    if (modal) modal.classList.remove('open');
}

// --- EL VIGILANTE (OBSERVER) ---
function srlStartObserver() {
    const modalBox = document.querySelector('.srl-modal-box');
    if (!modalBox) return;

    // Si ya existe un observer previo, lo desconectamos (opcional pero limpio)
    if (window.srlObserver) window.srlObserver.disconnect();

    window.srlObserver = new MutationObserver(function (mutations) {

        if (downloadTriggered) return; // Si ya descargó, no hacer nada más.

        // 1. Buscar mensajes de ÉXITO
        const successMsg = modalBox.querySelector('.mailpoet_success_message_server') ||
            modalBox.querySelector('.mailpoet_validate_success');

        // 2. Buscar mensajes de ERROR (Captcha, campo vacío, etc)
        const errorMsg = modalBox.querySelector('.mailpoet_error_message') ||
            modalBox.querySelector('.mailpoet_validate_error');

        // LÓGICA SIMPLIFICADA:
        // - ¿Hay mensaje de éxito visible?
        // - ¿NO hay mensaje de error visible?

        const isSuccessVisible = successMsg && successMsg.offsetParent !== null && successMsg.innerText.trim().length > 0;
        const isErrorVisible = errorMsg && errorMsg.offsetParent !== null;

        if (isSuccessVisible && !isErrorVisible) {
            // ¡BINGO! 
            downloadTriggered = true; // Marcar como hecho

            if (currentFileUrl) {
                // Esperamos 1.5 segundos
                setTimeout(() => {
                    window.location.href = currentFileUrl;

                    // Cerrar modal un poco después
                    setTimeout(() => {
                        srlCloseModal();
                    }, 500);
                }, 1500);
            }

            // Dejar de vigilar
            window.srlObserver.disconnect();
        }
    });

    // Empezar a vigilar cambios en el HTML del modal
    window.srlObserver.observe(modalBox, { childList: true, subtree: true, attributes: true });
}

document.addEventListener('DOMContentLoaded', function () {
    // Filtros
    const filterBtns = document.querySelectorAll('.srl-filter-btn');
    const cards = document.querySelectorAll('.srl-card');

    if (filterBtns.length > 0) {
        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const filterValue = btn.getAttribute('data-filter');
                cards.forEach(card => {
                    const cardCats = card.getAttribute('data-categories');
                    if (filterValue === 'all' || (cardCats && cardCats.includes(filterValue))) {
                        card.classList.remove('hidden');
                        card.style.opacity = '0';
                        setTimeout(() => card.style.opacity = '1', 50);
                    } else {
                        card.classList.add('hidden');
                    }
                });
            });
        });
    }

    const modal = document.getElementById('srlModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) srlCloseModal();
        });
    }
});