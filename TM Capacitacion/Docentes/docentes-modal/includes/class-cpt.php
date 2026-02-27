<?php
namespace DocentesModal;

class CPT
{

    public function __construct()
    {
        add_action('init', [$this, 'register_cpt']);
        add_action('init', [$this, 'register_taxonomies']); // NEW: Taxonomy
        add_action('after_setup_theme', [$this, 'add_image_sizes']); // NEW: Image Size
        add_action('add_meta_boxes', [$this, 'add_meta_boxes']); // UPDATED
        add_action('save_post', [$this, 'save_meta_boxes']); // UPDATED
        add_action('rest_api_init', [$this, 'register_rest_fields']);
    }

    public function register_cpt()
    {
        $labels = [
            'name' => _x('Docentes', 'Post Type General Name', 'docentes-modal'),
            'singular_name' => _x('Docente', 'Post Type Singular Name', 'docentes-modal'),
            'menu_name' => __('Docentes', 'docentes-modal'),
            'all_items' => __('Todos los Docentes', 'docentes-modal'),
            'add_new_item' => __('Añadir Nuevo Docente', 'docentes-modal'),
            'edit_item' => __('Editar Docente', 'docentes-modal'),
            'view_item' => __('Ver Docente', 'docentes-modal'),
        ];

        $args = [
            'label' => __('Docente', 'docentes-modal'),
            'labels' => $labels,
            'supports' => ['title', 'editor', 'thumbnail', 'excerpt', 'custom-fields'], // Added custom-fields support just in case
            'public' => false,
            'show_ui' => true,
            'show_in_rest' => true,
            'menu_icon' => 'dashicons-groups',
            'template' => $this->get_block_template(),
        ];

        register_post_type('docente', $args);
    }

    // NEW: Register Taxonomy
    public function register_taxonomies()
    {
        $labels = [
            'name' => _x('Etiquetas Docente', 'taxonomy general name', 'docentes-modal'),
            'singular_name' => _x('Etiqueta', 'taxonomy singular name', 'docentes-modal'),
            'search_items' => __('Buscar Etiquetas', 'docentes-modal'),
            'all_items' => __('Todas las Etiquetas', 'docentes-modal'),
            'edit_item' => __('Editar Etiqueta', 'docentes-modal'),
            'update_item' => __('Actualizar Etiqueta', 'docentes-modal'),
            'add_new_item' => __('Añadir Nueva Etiqueta', 'docentes-modal'),
            'new_item_name' => __('Nombre de Nueva Etiqueta', 'docentes-modal'),
            'menu_name' => __('Etiquetas', 'docentes-modal'),
        ];

        $args = [
            'hierarchical' => false, // Non-hierarchical (like tags)
            'labels' => $labels,
            'show_ui' => true,
            'show_admin_column' => true,
            'query_var' => true,
            'show_in_rest' => true,
            'rewrite' => ['slug' => 'docente-tag'],
        ];

        register_taxonomy('docente_tags', ['docente'], $args);
    }

    // NEW: Image Size
    public function add_image_sizes()
    {
        add_image_size('docente-card-thumb', 400, 350, true);
    }

    private function get_block_template()
    {
        return [
            [
                'core/heading',
                [
                    'level' => 3,
                    'content' => 'Biografía y Estudios (Contenido Completo)',
                ],
            ],
            [
                'core/paragraph',
                [
                    'placeholder' => 'Escribe aquí el contenido detallado, inserta galerías o grillas de cursos...',
                ],
            ],
        ];
    }

    public function add_meta_boxes()
    {
        // Cargo / Título Profesional
        add_meta_box(
            'docente_cargo_meta',
            __('Cargo / Título Profesional', 'docentes-modal'),
            [$this, 'render_cargo_meta_box'],
            'docente',
            'normal',
            'high'
        );

        // Deprecated but kept for compatibility logic if needed, or we can just remove it.
        // User instruction was to replace data flow. We will remove the old "Courses" meta box 
        // as per the new requirement to use the Block Editor for that content.
    }

    public function render_cargo_meta_box($post)
    {
        wp_nonce_field('save_docente_cargo', 'docente_cargo_nonce');
        $cargo = get_post_meta($post->ID, '_docente_cargo', true);
        ?>
        <label for="docente_cargo" style="display:block; margin-bottom: 5px;">
            <?php _e('Ej: Magíster en Educación, Ingeniero de Software, etc.', 'docentes-modal'); ?>
        </label>
        <input type="text" id="docente_cargo" name="docente_cargo" value="<?php echo esc_attr($cargo); ?>" style="width: 100%;">
        <p class="description">
            <?php _e('Se mostrará en la tarjeta debajo del nombre.', 'docentes-modal'); ?>
        </p>
        <?php
    }

    public function save_meta_boxes($post_id)
    {
        // Save Cargo
        if (isset($_POST['docente_cargo_nonce']) && wp_verify_nonce($_POST['docente_cargo_nonce'], 'save_docente_cargo')) {
            if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE)
                return;
            if (!current_user_can('edit_post', $post_id))
                return;

            if (isset($_POST['docente_cargo'])) {
                update_post_meta($post_id, '_docente_cargo', sanitize_text_field($_POST['docente_cargo']));
            }
        }
    }

    public function register_rest_fields()
    {
        // Featured Image Url
        register_rest_field('docente', 'featured_image_src', [
            'get_callback' => function ($object) {
                if (!empty($object['featured_media'])) {
                    $img = wp_get_attachment_image_src($object['featured_media'], 'large');
                    return $img ? $img[0] : null;
                }
                return null;
            }
        ]);

        // Cargo
        register_rest_field('docente', 'cargo', [
            'get_callback' => function ($object) {
                return get_post_meta($object['id'], '_docente_cargo', true) ?: '';
            }
        ]);

        // Tags
        register_rest_field('docente', 'tags_list', [
            'get_callback' => function ($object) {
                $terms = get_the_terms($object['id'], 'docente_tags');
                if (!$terms || is_wp_error($terms)) {
                    return [];
                }
                return array_map(function ($term) {
                    return [
                        'id' => $term->term_id,
                        'name' => $term->name,
                        'slug' => $term->slug
                    ];
                }, $terms);
            }
        ]);
    }
}
