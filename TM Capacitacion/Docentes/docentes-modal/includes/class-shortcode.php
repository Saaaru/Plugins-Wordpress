<?php
namespace DocentesModal;

class Shortcode
{

    public function __construct()
    {
        add_shortcode('docentes_grid', [$this, 'render_shortcode']);
    }

    public function render_shortcode($atts)
    {
        $atts = shortcode_atts([
            'columnas' => 3,
        ], $atts);

        $query = new \WP_Query([
            'post_type' => 'docente',
            'posts_per_page' => -1,
            'status' => 'publish', // Ensur publish only
        ]);

        if (!$query->have_posts()) {
            return '<p>' . __('No hay docentes registrados.', 'docentes-modal') . '</p>';
        }

        ob_start();
        ?>
        <div class="dm-grid" style="--dm-columns: <?php echo esc_attr($atts['columnas']); ?>;">
            <?php while ($query->have_posts()):
                $query->the_post();
                $id = get_the_ID();
                $cargo = get_post_meta($id, '_docente_cargo', true);
                $terms = get_the_terms($id, 'docente_tags');
                ?>
                <article class="dm-card">
                    <figure class="dm-card__image-wrapper">
                        <?php if (has_post_thumbnail()): ?>
                            <?php the_post_thumbnail('docente-card-thumb', ['class' => 'dm-card__image']); ?>
                        <?php else: ?>
                            <div class="dm-card__placeholder">
                                <?php echo substr(get_the_title(), 0, 2); ?>
                            </div>
                        <?php endif; ?>
                    </figure>
                    <div class="dm-card__content">
                        <h3 class="dm-card__title"><?php the_title(); ?></h3>

                        <?php if ($cargo): ?>
                            <div class="dm-card__cargo"><?php echo esc_html($cargo); ?></div>
                        <?php endif; ?>

                        <?php if ($terms && !is_wp_error($terms)): ?>
                            <div class="dm-card__tags">
                                <?php foreach ($terms as $term): ?>
                                    <span class="dm-tag"><?php echo esc_html($term->name); ?></span>
                                <?php endforeach; ?>
                            </div>
                        <?php endif; ?>

                        <button class="dm-trigger" data-id="<?php echo esc_attr($id); ?>">
                            <?php esc_html_e('Ver Perfil', 'docentes-modal'); ?>
                        </button>
                    </div>
                </article>
            <?php endwhile; ?>
        </div>
        <?php
        wp_reset_postdata();
        return ob_get_clean();
    }
}
