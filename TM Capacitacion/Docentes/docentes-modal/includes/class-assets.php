<?php
namespace DocentesModal;

class Assets
{

    public function __construct()
    {
        add_action('wp_enqueue_scripts', [$this, 'enqueue_scripts']);
        add_action('wp_footer', [$this, 'render_modal_skeleton']);
    }

    public function enqueue_scripts()
    {
        wp_enqueue_style(
            'docentes-modal-style',
            DOCENTES_MODAL_URL . 'assets/css/modal.css',
            [],
            DOCENTES_MODAL_VERSION
        );

        wp_enqueue_script(
            'docentes-modal-script',
            DOCENTES_MODAL_URL . 'assets/js/modal.js',
            [], // Vanilla JS, no jQuery dependency
            DOCENTES_MODAL_VERSION,
            true
        );

        wp_localize_script('docentes-modal-script', 'DocentesModalData', [
            'root_url' => esc_url_raw(rest_url()),
            'nonce' => wp_create_nonce('wp_rest'),
        ]);
    }

    public function render_modal_skeleton()
    {
        include DOCENTES_MODAL_PATH . 'templates/modal-skeleton.php';
    }
}
