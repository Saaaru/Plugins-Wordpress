<?php
/**
 * Plugin Name: Librería de Recursos
 * Description: Recursos descargables con segmentación por formulario.
 * Version: 1.2
 * Author: Solvitu
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: simple-resources
 * Domain Path: /languages
 */

if (!defined('ABSPATH')) {
    exit;
}

// 1. REGISTRAR CPT Y TAXONOMÍA
function srl_init()
{
    register_taxonomy('resource_category', 'resource_item', array(
        'labels' => array(
            'name' => __('Categorías', 'simple-resources'),
            'singular_name' => __('Categoría', 'simple-resources')
        ),
        'hierarchical' => true,
        'show_ui' => true,
        'query_var' => true,
    ));

    register_post_type('resource_item', array(
        'labels' => array(
            'name' => __('Recursos', 'simple-resources'),
            'singular_name' => __('Recurso', 'simple-resources'),
            'add_new_item' => __('Añadir Nuevo Recurso', 'simple-resources')
        ),
        'public' => false,
        'show_ui' => true,
        'menu_icon' => 'dashicons-portfolio',
        'supports' => array('title', 'editor', 'thumbnail'),
    ));
}
add_action('init', 'srl_init');

// 2. METABOXES: ARCHIVO Y SHORTCODE ESPECÍFICO
function srl_add_meta_boxes()
{
    add_meta_box(
        'srl_file_info',
        __('Configuración de Descarga', 'simple-resources'),
        'srl_meta_box_callback',
        'resource_item',
        'normal',
        'high'
    );
}
add_action('add_meta_boxes', 'srl_add_meta_boxes');

function srl_meta_box_callback($post)
{
    // Security Nonce
    wp_nonce_field('srl_save_meta_box', 'srl_meta_box_nonce');

    $file_type = get_post_meta($post->ID, '_srl_file_type', true);
    $file_url = get_post_meta($post->ID, '_srl_file_url', true);
    $custom_form = get_post_meta($post->ID, '_srl_custom_form', true);
    wp_nonce_field('srl_save_manage_resource', 'srl_resource_nonce');
    ?>
    <p>
        <label><strong><?php _e('Tipo (Badge):', 'simple-resources'); ?></strong></label>
        <input type="text" name="srl_file_type_field" value="<?php echo esc_attr($file_type); ?>" placeholder="PDF"
            style="width:80px;">
    </p>
    <p>
        <label><strong><?php _e('Archivo:', 'simple-resources'); ?></strong></label><br>
        <input type="text" name="srl_file_url_field" id="srl_file_url_field" value="<?php echo esc_url($file_url); ?>"
            style="width:70%;">
        <button type="button" class="button" id="srl_upload_btn"><?php _e('Seleccionar', 'simple-resources'); ?></button>
    </p>
    <hr>
    <p>
        <label><strong><?php _e('Shortcode del Formulario (Opcional):', 'simple-resources'); ?></strong></label><br>
        <input type="text" name="srl_custom_form_field" value="<?php echo esc_attr($custom_form); ?>" style="width:100%;"
            placeholder="[mailpoet_form id='2']">
        <span class="description"><?php _e('Si lo dejas vacío, se usará el formulario por defecto de Ajustes. Úsalo para segmentar por listas.', 'simple-resources'); ?></span>
    </p>
    <?php
}

function srl_save_meta_box($post_id)
{
    // Verificar nonce
    if (!isset($_POST['srl_resource_nonce']) || !wp_verify_nonce($_POST['srl_resource_nonce'], 'srl_save_manage_resource')) {
        if (!isset($_POST['srl_meta_box_nonce']) || !wp_verify_nonce($_POST['srl_meta_box_nonce'], 'srl_save_meta_box')) {
            return;
        }
    }

    // Verificar si es un guardado automático
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }

    // Verificar permisos
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    if (array_key_exists('srl_file_type_field', $_POST))
        update_post_meta($post_id, '_srl_file_type', sanitize_text_field($_POST['srl_file_type_field']));
    if (array_key_exists('srl_file_url_field', $_POST))
        update_post_meta($post_id, '_srl_file_url', esc_url_raw($_POST['srl_file_url_field']));
    if (array_key_exists('srl_custom_form_field', $_POST))
        update_post_meta($post_id, '_srl_custom_form', sanitize_text_field($_POST['srl_custom_form_field']));
}
add_action('save_post', 'srl_save_meta_box');

// 3. ASSETS
function srl_enqueue_admin($hook)
{
    global $post;
    if (($hook == 'post-new.php' || $hook == 'post.php') && 'resource_item' === $post->post_type) {
        wp_enqueue_media();
        wp_enqueue_script('srl-admin-js', plugin_dir_url(__FILE__) . 'admin.js', array('jquery'), '1.0', true);
    }
}
add_action('admin_enqueue_scripts', 'srl_enqueue_admin');

function srl_enqueue_frontend()
{
    wp_enqueue_style('srl-style', plugin_dir_url(__FILE__) . 'style.css');
    wp_enqueue_script('srl-script', plugin_dir_url(__FILE__) . 'script.js', array(), '1.0', true);
}
add_action('wp_enqueue_scripts', 'srl_enqueue_frontend');

// 4. AJUSTES (FORMULARIO POR DEFECTO)
function srl_add_admin_menu()
{
    add_submenu_page(
        'edit.php?post_type=resource_item',
        __('Ajustes', 'simple-resources'),
        __('Ajustes', 'simple-resources'),
        'manage_options',
        'srl-settings',
        'srl_settings_page'
    );
}
add_action('admin_menu', 'srl_add_admin_menu');

function srl_settings_page()
{
    ?>
    <div class="wrap">
        <h1><?php _e('Ajustes Generales', 'simple-resources'); ?></h1>
        <form method="post" action="options.php">
            <?php settings_fields('srl_options_group');
            do_settings_sections('srl-settings'); ?>
            <h3><?php _e('Formulario por Defecto', 'simple-resources'); ?></h3>
            <textarea name="srl_popup_content" rows="5"
                class="large-text code"><?php echo esc_textarea(get_option('srl_popup_content')); ?></textarea>
            <p><?php _e('Este formulario saldrá si no especificas uno en el recurso individual.', 'simple-resources'); ?></p>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}
function srl_register_settings()
{
    register_setting('srl_options_group', 'srl_popup_content');
}
add_action('admin_init', 'srl_register_settings');

// 5. SHORTCODE
function srl_shortcode_function()
{
    $terms = get_terms(array('taxonomy' => 'resource_category', 'hide_empty' => true));
    $query = new WP_Query(array('post_type' => 'resource_item', 'posts_per_page' => -1));
    $default_form = get_option('srl_popup_content');

    ob_start();
    ?>
    <div class="srl-wrapper">
        <div class="srl-filters">
            <button class="srl-filter-btn active" data-filter="all"><?php _e('Todos', 'simple-resources'); ?></button>
            <?php foreach ($terms as $term): ?>
                <button class="srl-filter-btn" data-filter="<?php echo esc_attr($term->slug); ?>">
                    <?php echo esc_html($term->name); ?>
                </button>
            <?php endforeach; ?>
        </div>

        <div class="srl-grid">
            <?php if ($query->have_posts()):
                while ($query->have_posts()):
                    $query->the_post();
                    $term_slugs = wp_list_pluck(get_the_terms(get_the_ID(), 'resource_category') ?: [], 'slug');
                    $file_type = get_post_meta(get_the_ID(), '_srl_file_type', true);
                    $file_url = get_post_meta(get_the_ID(), '_srl_file_url', true);

                    // LÓGICA DEL FORMULARIO
                    $custom_form = get_post_meta(get_the_ID(), '_srl_custom_form', true);
                    $form_to_use = !empty($custom_form) ? $custom_form : $default_form;
                    // Generamos un ID único para esconder este formulario
                    $unique_id = 'form-source-' . get_the_ID();

                    $thumb = get_the_post_thumbnail_url(get_the_ID(), 'medium') ?: 'https://via.placeholder.com/300x200';
                    ?>

                    <!-- TARJETA -->
                    <div class="srl-card" data-categories="<?php echo esc_attr(implode(' ', $term_slugs)); ?>">
                        <div class="srl-thumb-wrapper">
                            <img src="<?php echo esc_url($thumb); ?>" class="srl-thumb">
                            <?php if ($file_type): ?><span class="srl-type-badge">
                                    <?php echo esc_html($file_type); ?>
                                </span>
                            <?php endif; ?>
                        </div>
                        <div class="srl-content">
                            <h3 class="srl-title">
                                <?php the_title(); ?>
                            </h3>
                            <div class="srl-desc">
                                <?php the_content(); ?>
                            </div>

                            <!-- El botón sabe qué archivo quiere Y dónde está su formulario específico -->
<<<<<<< HEAD
                            <button class="srl-download-btn" data-title="<?php echo esc_attr(get_the_title()); ?>"
                                data-file-url="<?php echo esc_url($file_url); ?>"
                                data-form-source="<?php echo esc_attr($unique_id); ?>"
                                onclick="srlOpenModal(this)">Descargar</button>
=======
                            <button class="srl-download-btn" data-title="<?php the_title(); ?>"
                                data-file-url="<?php echo esc_url($file_url); ?>" data-form-source="<?php echo $unique_id; ?>"
                                onclick="srlOpenModal(this)"><?php _e('Descargar', 'simple-resources'); ?></button>
>>>>>>> 659c3e4b4ffc1c7c89ce62fe642eb0918eee5012
                        </div>

                        <!-- FORMULARIO OCULTO (Pre-renderizado) -->
                        <div id="<?php echo $unique_id; ?>" style="display:none;">
                            <?php echo do_shortcode($form_to_use); ?>
                        </div>
                    </div>

                <?php endwhile; endif;
            wp_reset_postdata(); ?>
        </div>

        <!-- MODAL (VACÍO INICIALMENTE) -->
        <div class="srl-modal-overlay" id="srlModal">
            <div class="srl-modal-box">
                <button class="srl-close-modal" onclick="srlCloseModal()">&times;</button>
                <h3 class="srl-modal-title"><?php _e('Descargar Recurso', 'simple-resources'); ?></h3>
                <p class="srl-modal-subtitle"><?php _e('Estás solicitando:', 'simple-resources'); ?> <strong id="srlResourceName">...</strong></p>

                <!-- Aquí inyectaremos el formulario dinámicamente -->
                <div class="srl-modal-content" id="srlModalContent"></div>
            </div>
        </div>
    </div>
    <?php return ob_get_clean();
}
add_shortcode('ver_recursos', 'srl_shortcode_function');