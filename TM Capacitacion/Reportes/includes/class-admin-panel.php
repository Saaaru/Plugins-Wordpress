<?php
/**
 * Clase TM_Reportes_Admin_Panel
 * 
 * Panel de programación de envíos con acciones (activar/pausar/enviar/historial).
 * También renderiza la página de historial de envíos.
 */

if (!defined('ABSPATH')) {
    exit;
}

class TM_Reportes_Admin_Panel
{
    /**
     * Wrapper estático para WordPress callback
     */
    public static function render_panel_static()
    {
        $instance = new self();
        $instance->render_panel();
    }

    /**
     * Wrapper estático para WordPress callback
     */
    public static function render_historial_static()
    {
        $instance = new self();
        $instance->render_historial();
    }

    /**
     * Renderizar el panel de programación de envíos
     */
    public function render_panel()
    {
        $db = TM_Reportes_DB::get_instance();
        $mensaje = '';

        // === PROCESAR ACCIONES GET ===
        $accion = $_GET['tm_panel_action'] ?? '';
        $config_id = isset($_GET['id']) ? intval($_GET['id']) : 0;

        if ($accion && $config_id) {
            $nonce_action = 'tm_panel_' . $accion . '_' . $config_id;
            if (isset($_GET['_wpnonce']) && wp_verify_nonce($_GET['_wpnonce'], $nonce_action)) {
                switch ($accion) {
                    case 'activar':
                        $db->actualizar_config($config_id, ['activo' => 1]);
                        // Recalcular próximo envío
                        $config = $db->obtener_config($config_id);
                        if ($config) {
                            $scheduler = new TM_Reportes_Scheduler();
                            $proximo = $scheduler->calcular_proximo_envio($config);
                            $db->actualizar_config($config_id, ['proximo_envio' => $proximo]);
                        }
                        $mensaje = '<div class="notice notice-success is-dismissible"><p>Envío activado correctamente.</p></div>';
                        break;

                    case 'pausar':
                        $db->actualizar_config($config_id, ['activo' => 0]);
                        $mensaje = '<div class="notice notice-warning is-dismissible"><p>Envío pausado.</p></div>';
                        break;

                    case 'enviar_ahora':
                        $scheduler = new TM_Reportes_Scheduler();
                        $resultado = $scheduler->enviar_ahora($config_id);
                        if ($resultado['exito']) {
                            $mensaje = '<div class="notice notice-success is-dismissible"><p>✅ ' . esc_html($resultado['mensaje']) . '</p></div>';
                        } else {
                            $mensaje = '<div class="notice notice-error is-dismissible"><p>❌ ' . esc_html($resultado['mensaje']) . '</p></div>';
                        }
                        break;

                    case 'eliminar':
                        $db->eliminar_config($config_id);
                        $mensaje = '<div class="notice notice-success is-dismissible"><p>Configuración eliminada.</p></div>';
                        break;
                }
            }
        }

        $configs = $db->obtener_todas_configs();
        ?>

        <div class="wrap">
            <h1>📅 Panel de Programación de Envíos</h1>
            <p>Controla y monitorea todos los envíos automáticos de reportes.</p>
            <?php echo $mensaje; ?>

            <div style="background:#fff;padding:20px;border-radius:5px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                <?php if (empty($configs)): ?>
                    <div style="text-align:center;padding:40px;">
                        <span class="dashicons dashicons-calendar-alt" style="font-size:48px;color:#ccc;width:48px;height:48px;"></span>
                        <h3>No hay programaciones configuradas</h3>
                        <p>Ve a <a href="<?php echo admin_url('admin.php?page=tm-reportes-config'); ?>">Configuración</a> para crear una nueva programación de envío.</p>
                    </div>
                <?php else: ?>
                    <table class="wp-list-table widefat fixed striping" id="tabla-programacion">
                        <thead>
                            <tr>
                                <th style="width:20%;">Curso</th>
                                <th style="width:15%;">Institución</th>
                                <th style="width:15%;">Coordinador</th>
                                <th style="width:10%;">Frecuencia</th>
                                <th style="width:15%;">Próximo Envío</th>
                                <th style="width:5%;">Estado</th>
                                <th style="width:20%;">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($configs as $config): 
                                $freqs = [
                                    'diario'  => 'Diario',
                                    'semanal' => 'Semanal',
                                    'mensual' => 'Mensual',
                                ];
                                $freq_label = $freqs[$config['frecuencia']] ?? $config['frecuencia'];
                                
                                // Estado
                                $activa = intval($config['activo']) === 1;
                                
                                // Próximo envío
                                $proximo = !empty($config['proximo_envio']) 
                                    ? date_i18n('d-m-Y H:i', strtotime($config['proximo_envio'])) 
                                    : '—';
                            ?>
                                <tr>
                                    <td>
                                        <strong><?php echo esc_html($config['curso_nombre']); ?></strong>
                                        <?php
                                        $tipos_label = [
                                            'general' => 'Avance',
                                            'notas'   => 'Calificaciones',
                                            'accesos' => 'Accesos',
                                        ];
                                        echo '<br><small style="color:#666;">Tipo: ' . esc_html($tipos_label[$config['tipo_reporte']] ?? $config['tipo_reporte']) . '</small>';
                                        ?>
                                    </td>
                                    <td><?php echo esc_html($config['institucion']); ?></td>
                                    <td>
                                        <?php echo esc_html($config['nombre_coordinador']); ?>
                                        <br><small style="color:#666;"><?php echo esc_html($config['correo_coordinador']); ?></small>
                                    </td>
                                    <td><?php echo esc_html($freq_label); ?></td>
                                    <td>
                                        <?php echo esc_html($proximo); ?>
                                        <?php if (!empty($config['ultimo_envio'])): ?>
                                            <br><small style="color:#999;">Último: <?php echo esc_html(date_i18n('d-m-Y H:i', strtotime($config['ultimo_envio']))); ?></small>
                                        <?php endif; ?>
                                    </td>
                                    <td>
                                        <?php if ($activa): ?>
                                            <span style="color:#46b450;font-weight:bold;">● Activo</span>
                                        <?php else: ?>
                                            <span style="color:#dc3232;font-weight:bold;">● Pausado</span>
                                        <?php endif; ?>
                                    </td>
                                    <td>
                                        <?php if ($activa): ?>
                                            <a href="<?php echo wp_nonce_url(admin_url('admin.php?page=tm-reportes-panel&tm_panel_action=pausar&id=' . $config['id']), 'tm_panel_pausar_' . $config['id']); ?>"
                                                class="button button-small" title="Pausar envíos">⏸ Pausar</a>
                                        <?php else: ?>
                                            <a href="<?php echo wp_nonce_url(admin_url('admin.php?page=tm-reportes-panel&tm_panel_action=activar&id=' . $config['id']), 'tm_panel_activar_' . $config['id']); ?>"
                                                class="button button-small button-primary" title="Activar envíos">▶ Activar</a>
                                        <?php endif; ?>

                                        <a href="<?php echo wp_nonce_url(admin_url('admin.php?page=tm-reportes-panel&tm_panel_action=enviar_ahora&id=' . $config['id']), 'tm_panel_enviar_ahora_' . $config['id']); ?>"
                                            class="button button-small" title="Enviar reporte ahora"
                                            onclick="return confirm('¿Enviar el reporte ahora mismo?')">📤 Enviar</a>

                                        <a href="<?php echo admin_url('admin.php?page=tm-reportes-panel&action=historial&id=' . $config['id']); ?>"
                                            class="button button-small" title="Ver historial de envíos">📜 Historial</a>

                                        <a href="<?php echo admin_url('admin.php?page=tm-reportes-config&action=editar&id=' . $config['id']); ?>"
                                            class="button button-small" title="Editar configuración">✏️ Editar</a>
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>

                    <div style="margin-top:15px;padding:10px;background:#f0f0f1;border-radius:4px;font-size:12px;color:#666;">
                        <strong>ℹ️ Información:</strong> El sistema verifica los envíos pendientes cada 15 minutos automáticamente. 
                        Solo se envían reportes dentro del rango de fechas configurado (si aplica).
                    </div>
                <?php endif; ?>
            </div>
        </div>
        <?php
    }

    /**
     * Renderizar la página de historial de envíos
     */
    public function render_historial()
    {
        $db = TM_Reportes_DB::get_instance();

        // Si hay un ID específico, mostrar historial de esa config
        $config_id = isset($_GET['id']) ? intval($_GET['id']) : 0;

        if ($config_id > 0) {
            $config = $db->obtener_config($config_id);
            $historial = $db->obtener_historial_config($config_id);
            $titulo = 'Historial de Envíos: ' . ($config ? $config['curso_nombre'] : 'Configuración #' . $config_id);
            $volver_url = admin_url('admin.php?page=tm-reportes-panel');
        } else {
            $historial = $db->obtener_historial_completo();
            $titulo = '📜 Historial Completo de Envíos';
            $volver_url = admin_url('admin.php?page=tm-reportes-panel');
        }
        ?>

        <div class="wrap">
            <h1><?php echo esc_html($titulo); ?></h1>
            <p><a href="<?php echo esc_url($volver_url); ?>">← Volver al Panel</a></p>

            <div style="background:#fff;padding:20px;border-radius:5px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                <?php if (empty($historial)): ?>
                    <div style="text-align:center;padding:40px;">
                        <span class="dashicons dashicons-history" style="font-size:48px;color:#ccc;width:48px;height:48px;"></span>
                        <h3>No hay envíos registrados</h3>
                        <p>Aún no se ha enviado ningún reporte para esta configuración.</p>
                    </div>
                <?php else: ?>
                    <table class="wp-list-table widefat fixed striping">
                        <thead>
                            <tr>
                                <th style="width:5%;">ID</th>
                                <th style="width:20%;">Curso</th>
                                <th style="width:15%;">Coordinador</th>
                                <th style="width:25%;">Destino</th>
                                <th style="width:10%;">Tipo</th>
                                <th style="width:10%;">Estado</th>
                                <th style="width:15%;">Fecha</th>
                                <th style="width:10%;">Error</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($historial as $entry): 
                                $tipos = [
                                    'general' => 'Avance General',
                                    'notas'   => 'Calificaciones',
                                    'accesos' => 'Último Acceso',
                                ];
                                $tipo_label = $tipos[$entry['tipo_reporte']] ?? $entry['tipo_reporte'];
                                $enviado = $entry['estado'] === 'enviado';
                            ?>
                                <tr>
                                    <td>#<?php echo intval($entry['id']); ?></td>
                                    <td><strong><?php echo esc_html($entry['curso_nombre']); ?></strong></td>
                                    <td><?php echo esc_html($entry['coordinador']); ?></td>
                                    <td style="font-size:12px;"><?php echo esc_html($entry['correo_destino']); ?></td>
                                    <td><?php echo esc_html($tipo_label); ?></td>
                                    <td>
                                        <?php if ($enviado): ?>
                                            <span style="color:#46b450;font-weight:bold;">✅ Enviado</span>
                                        <?php else: ?>
                                            <span style="color:#dc3232;font-weight:bold;">❌ Fallido</span>
                                        <?php endif; ?>
                                    </td>
                                    <td><?php echo esc_html(date_i18n('d-m-Y H:i', strtotime($entry['fecha_envio']))); ?></td>
                                    <td>
                                        <?php if (!empty($entry['mensaje_error'])): ?>
                                            <span style="color:#dc3232;font-size:11px;" title="<?php echo esc_attr($entry['mensaje_error']); ?>">
                                                <?php echo esc_html(substr($entry['mensaje_error'], 0, 30)); ?>...
                                            </span>
                                        <?php else: ?>
                                            <span style="color:#999;">—</span>
                                        <?php endif; ?>
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                <?php endif; ?>
            </div>
        </div>
        <?php
    }
}
