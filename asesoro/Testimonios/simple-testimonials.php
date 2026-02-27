<?php
/**
 * Plugin Name: Simple Testimonials Slider
 * Description: Un slider de testimonios ligero, con CPT y estilos heredados. Usa el shortcode [ver_testimonios].
 * Version: 1.5
 * Author: Solvitu
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: simple-testimonials
 * Domain Path: /languages
 */

if (!defined('ABSPATH')) {
    exit; // Seguridad
}

// 1. REGISTRAR EL CUSTOM POST TYPE (CPT)
function sts_register_cpt()
{
    $labels = array(
        'name' => __('Testimonios', 'simple-testimonials'),
        'singular_name' => __('Testimonio', 'simple-testimonials'),
        'menu_name' => __('Testimonios', 'simple-testimonials'),
        'add_new' => __('Añadir Nuevo', 'simple-testimonials'),
        'add_new_item' => __('Añadir Nuevo Testimonio', 'simple-testimonials'),
        'edit_item' => __('Editar Testimonio', 'simple-testimonials'),
        'new_item' => __('Nuevo Testimonio', 'simple-testimonials'),
        'view_item' => __('Ver Testimonio', 'simple-testimonials'),
        'search_items' => __('Buscar Testimonios', 'simple-testimonials'),
        'not_found' => __('No se encontraron testimonios', 'simple-testimonials'),
    );

    $args = array(
        'labels' => $labels,
        'public' => false, // No necesitamos una página pública individual para cada testimonio
        'show_ui' => true,  // Sí queremos verlo en el admin
        'menu_icon' => 'dashicons-format-quote',
        'supports' => array('title', 'editor', 'thumbnail'), // Título (Nombre), Editor (Texto), Imagen (Foto)
        'rewrite' => false,
    );

    register_post_type('testimonial', $args);
}
add_action('init', 'sts_register_cpt');

// 2. AÑADIR CAMPO PERSONALIZADO PARA "EMPRESA"
function sts_add_meta_box()
{
    add_meta_box(
        'testimonial_company',
        __('Empresa / Cargo', 'simple-testimonials'),
        'sts_meta_box_callback',
        'testimonial',
        'normal',
        'high'
    );
}
add_action('add_meta_boxes', 'sts_add_meta_box');

function sts_meta_box_callback($post)
{
    // Usar nonce para verificación
    wp_nonce_field('sts_save_meta_box', 'sts_meta_box_nonce');
    $value = get_post_meta($post->ID, '_testimonial_company', true);
    ?>
    <p>
        <label for="sts_company_field"><?php _e('Nombre de la empresa o cargo:', 'simple-testimonials'); ?></label>
        <input type="text" id="sts_company_field" name="sts_company_field" value="<?php echo esc_attr($value); ?>"
            style="width:100%;" />
    </p>
    <?php
}

function sts_save_meta_box($post_id)
{
    // Verificar nonce
    if (!isset($_POST['sts_meta_box_nonce']) || !wp_verify_nonce($_POST['sts_meta_box_nonce'], 'sts_save_meta_box')) {
        return;
    }

    // Verificar si es un guardado automático
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }

    // Verificar permisos
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    if (array_key_exists('sts_company_field', $_POST)) {
        update_post_meta($post_id, '_testimonial_company', sanitize_text_field($_POST['sts_company_field']));
    }
}
add_action('save_post', 'sts_save_meta_box');

// 3. CARGAR SCRIPTS Y ESTILOS
function sts_enqueue_assets()
{
    // Solo cargamos si el shortcode está presente (opcional, aquí lo cargamos siempre para simplificar)
    wp_enqueue_style('sts-style', plugin_dir_url(__FILE__) . 'style.css');
    wp_enqueue_script('sts-script', plugin_dir_url(__FILE__) . 'script.js', array(), '1.0', true);
}
add_action('wp_enqueue_scripts', 'sts_enqueue_assets');

// 4. CREAR EL SHORTCODE [ver_testimonios]
function sts_shortcode_function()
{
    $args = array(
        'post_type' => 'testimonial',
        'posts_per_page' => -1, // Traer todos
        'orderby' => 'date',
        'order' => 'DESC',
    );

    $query = new WP_Query($args);

    if (!$query->have_posts()) {
        return '<p>' . __('No hay testimonios aún.', 'simple-testimonials') . '</p>';
    }

    ob_start();
    ?>

    <!-- Contenedor Principal -->
    <div class="sts-wrapper">
        <div class="sts-plugin-container" id="sts-container">

            <!-- Flecha Izquierda -->
            <button class="sts-nav-btn sts-prev"
                aria-label="<?php esc_attr_e('Anterior', 'simple-testimonials'); ?>">&#10094;</button>

            <!-- Viewport -->
            <div class="sts-slider-viewport">
                <div class="sts-slider-track">
                    <?php while ($query->have_posts()):
                        $query->the_post();
                        $company = get_post_meta(get_the_ID(), '_testimonial_company', true);
                        $thumb_url = get_the_post_thumbnail_url(get_the_ID(), 'thumbnail');
                        if (!$thumb_url) {
                            $thumb_url = 'https://www.gravatar.com/avatar/?d=mp&s=150';
                        }
                        ?>

                        <div class="sts-card">
                            <div class="sts-inner-card"> <!-- Nuevo contenedor interno para padding -->
                                <div class="sts-body">
                                    <div class="sts-content" id="sts-txt-<?php echo get_the_ID(); ?>">
                                        <?php echo apply_filters('the_content', get_the_content()); ?>
                                    </div>
                                    <button class="sts-read-more"
                                        data-target="sts-txt-<?php echo get_the_ID(); ?>"><?php _e('Ver más', 'simple-testimonials'); ?></button>
                                </div>

                                <div class="sts-author-block">
                                    <img src="<?php echo esc_url($thumb_url); ?>" alt="<?php echo esc_attr(get_the_title()); ?>"
                                        class="sts-thumb">
                                    <div class="sts-author-details">
                                        <div class="sts-name"><?php echo esc_html(get_the_title()); ?></div>
                                        <?php if ($company): ?>
                                            <div class="sts-company"><?php echo esc_html($company); ?></div>
                                        <?php endif; ?>
                                    </div>
                                </div>
                            </div>
                        </div>

                    <?php endwhile;
                    wp_reset_postdata(); ?>
                </div>
            </div>

            <!-- Flecha Derecha -->
            <button class="sts-nav-btn sts-next"
                aria-label="<?php esc_attr_e('Siguiente', 'simple-testimonials'); ?>">&#10095;</button>
        </div>

        <!-- Puntos de Paginación (Dots) -->
        <div class="sts-dots-container" id="sts-dots"></div>
    </div>

    <?php
    return ob_get_clean();
}
add_shortcode('ver_testimonios', 'sts_shortcode_function');