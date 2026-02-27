<div id="dm-modal-overlay" class="dm-modal__overlay" aria-hidden="true">
    <div class="dm-modal" role="dialog" aria-modal="true" aria-labelledby="dm-modal-title">
        <header class="dm-modal__header">
            <h2 id="dm-modal-title" class="dm-modal__title"></h2>
            <button class="dm-modal__close-icon"
                aria-label="<?php esc_html_e('Cerrar', 'docentes-modal'); ?>">&times;</button>
        </header>

        <div class="dm-modal__body" id="dm-modal-body">
            <div class="dm-spinner">
                <!-- Simple CSS Spinner -->
                <div class="dm-spinner__circle"></div>
            </div>
            <div id="dm-modal-content" class="dm-modal__content"></div>
        </div>

        <footer class="dm-modal__footer">
            <button class="dm-modal__close-btn">
                <?php esc_html_e('Cerrar', 'docentes-modal'); ?>
            </button>
        </footer>
    </div>
</div>