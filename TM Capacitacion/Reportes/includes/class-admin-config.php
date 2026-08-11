<?php
/**
 * Clase TM_Reportes_Admin_Config
 * 
 * Interfaz de administración para configurar coordinadores por curso.
 * Permite crear, editar y eliminar configuraciones de envío automático.
 */

if (!defined('ABSPATH')) {
    exit;
}

class TM_Reportes_Admin_Config
{
    /**
     * Wrapper estático para WordPress callback
     */
    public static function render_static()
    {
        $instance = new self();
        $instance->render();
    }

    /**
     * Renderizar la página de configuración
     */
    public function render()
    {
        $db = TM_Reportes_DB::get_instance();
        $mensaje = '';

        // === PROCESAR ACCIONES POST ===
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $mensaje = $this->procesar_formulario();
        }

        // === PROCESAR ACCIONES GET (eliminar) ===
        if (isset($_GET['action']) && $_GET['action'] === 'eliminar' && isset($_GET['id'])) {
            $id = intval($_GET['id']);
            if (wp_verify_nonce($_GET['_wpnonce'] ?? '', 'tm_eliminar_config_' . $id)) {
                $db->eliminar_config($id);
                $mensaje = '<div class="notice notice-success is-dismissible"><p>Configuración eliminada correctamente.</p></div>';
            }
        }

        // Determinar si estamos editando
        $editando = false;
        $config_edit = null;
        if (isset($_GET['action']) && $_GET['action'] === 'editar' && isset($_GET['id'])) {
            $editando = true;
            $config_edit = $db->obtener_config(intval($_GET['id']));
        }

        $cursos = tm_reportes_obtener_cursos_moodle();
        $configs = $db->obtener_todas_configs();
        ?>

        <div class="wrap">
            <h1>⚙️ Configuración de Coordinadores</h1>
            <p>Configura los coordinadores y la programación de envío automático de reportes por curso.</p>
            <?php echo $mensaje; ?>

            <!-- === FORMULARIO DE ALTA / EDICIÓN === -->
            <div style="background:#fff;padding:20px;border-radius:5px;box-shadow:0 1px 3px rgba(0,0,0,0.1);margin-bottom:30px;">
                <h2 style="margin-top:0;">
                    <?php echo $editando ? '✏️ Editar Configuración' : '➕ Nueva Configuración'; ?>
                </h2>

                <form method="post" action="">
                    <?php if ($editando): ?>
                        <input type="hidden" name="tm_action" value="editar" />
                        <input type="hidden" name="config_id" value="<?php echo esc_attr($config_edit['id']); ?>" />
                    <?php else: ?>
                        <input type="hidden" name="tm_action" value="crear" />
                    <?php endif; ?>
                    <?php wp_nonce_field('tm_guardar_config'); ?>

                    <table class="form-table">
                        <tr>
                            <th scope="row"><label for="institucion">Institución</label></th>
                            <td>
                                <input type="text" name="institucion" id="institucion" class="regular-text" required
                                    value="<?php echo $editando ? esc_attr($config_edit['institucion']) : ''; ?>" />
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="nombre_coordinador">Nombre del Coordinador</label></th>
                            <td>
                                <input type="text" name="nombre_coordinador" id="nombre_coordinador" class="regular-text" required
                                    value="<?php echo $editando ? esc_attr($config_edit['nombre_coordinador']) : ''; ?>" />
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="correo_coordinador">Correo del Coordinador</label></th>
                            <td>
                                <input type="email" name="correo_coordinador" id="correo_coordinador" class="regular-text" required
                                    value="<?php echo $editando ? esc_attr($config_edit['correo_coordinador']) : ''; ?>" />
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="curso_id">Curso Asociado</label></th>
                            <td>
                                <select name="curso_id" id="curso_id" required style="min-width:300px;">
                                    <option value="">-- Seleccione un Curso --</option>
                                    <?php foreach ($cursos as $curso): ?>
                                        <option value="<?php echo $curso['id']; ?>"
                                            <?php echo $editando ? selected($config_edit['curso_id'], $curso['id']) : ''; ?>>
                                            <?php echo esc_html($curso['fullname']); ?>
                                        </option>
                                    <?php endforeach; ?>
                                </select>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="tipo_reporte">Tipo de Reporte</label></th>
                            <td>
                                <select name="tipo_reporte" id="tipo_reporte">
                                    <option value="general" <?php echo $editando ? selected($config_edit['tipo_reporte'], 'general') : ''; ?>>Avance General</option>
                                    <option value="notas" <?php echo $editando ? selected($config_edit['tipo_reporte'], 'notas') : ''; ?>>Calificaciones Parciales</option>
                                    <option value="accesos" <?php echo $editando ? selected($config_edit['tipo_reporte'], 'accesos') : ''; ?>>Último Acceso</option>
                                </select>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="frecuencia">Frecuencia de Envío</label></th>
                            <td>
                                <select name="frecuencia" id="frecuencia" onchange="tmToggleDiaEnvio()">
                                    <option value="diario" <?php echo $editando ? selected($config_edit['frecuencia'], 'diario') : ''; ?>>Diario</option>
                                    <option value="semanal" <?php echo $editando ? selected($config_edit['frecuencia'], 'semanal') : ''; ?>>Semanal</option>
                                    <option value="mensual" <?php echo $editando ? selected($config_edit['frecuencia'], 'mensual') : ''; ?>>Mensual</option>
                                </select>
                            </td>
                        </tr>
                        <tr id="fila-dia-envio">
                            <th scope="row"><label for="dia_envio">Día de Envío</label></th>
                            <td>
                                <select name="dia_envio_semanal" id="dia_envio_semanal" style="display:none;">
                                    <option value="monday" <?php echo $editando ? selected($config_edit['dia_envio'], 'monday') : ''; ?>>Lunes</option>
                                    <option value="tuesday" <?php echo $editando ? selected($config_edit['dia_envio'], 'tuesday') : ''; ?>>Martes</option>
                                    <option value="wednesday" <?php echo $editando ? selected($config_edit['dia_envio'], 'wednesday') : ''; ?>>Miércoles</option>
                                    <option value="thursday" <?php echo $editando ? selected($config_edit['dia_envio'], 'thursday') : ''; ?>>Jueves</option>
                                    <option value="friday" <?php echo $editando ? selected($config_edit['dia_envio'], 'friday') : ''; ?>>Viernes</option>
                                    <option value="saturday" <?php echo $editando ? selected($config_edit['dia_envio'], 'saturday') : ''; ?>>Sábado</option>
                                    <option value="sunday" <?php echo $editando ? selected($config_edit['dia_envio'], 'sunday') : ''; ?>>Domingo</option>
                                </select>
                                <select name="dia_envio_mensual" id="dia_envio_mensual" style="display:none;">
                                    <?php for ($d = 1; $d <= 31; $d++): ?>
                                        <option value="<?php echo $d; ?>" <?php echo $editando ? selected(intval($config_edit['dia_envio']), $d) : ''; ?>>
                                            Día <?php echo $d; ?>
                                        </option>
                                    <?php endfor; ?>
                                </select>
                                <span id="dia_envio_info" style="color:#666;font-size:12px;"></span>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="hora_envio">Hora de Envío</label></th>
                            <td>
                                <input type="time" name="hora_envio" id="hora_envio" required
                                    value="<?php echo $editando ? esc_attr($config_edit['hora_envio']) : '08:00'; ?>" />
                                <span style="color:#666;font-size:12px;">(Hora de Chile)</span>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="copia_interna">Copia Interna (CC)</label></th>
                            <td>
                                <textarea name="copia_interna" id="copia_interna" rows="3" class="large-text" placeholder="correo1@ejemplo.com, correo2@ejemplo.com"><?php echo $editando ? esc_textarea($config_edit['copia_interna']) : ''; ?></textarea>
                                <p class="description">Correos separados por coma o salto de línea.</p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="fecha_inicio">Fecha de Inicio</label></th>
                            <td>
                                <input type="date" name="fecha_inicio" id="fecha_inicio"
                                    value="<?php echo $editando ? esc_attr($config_edit['fecha_inicio']) : ''; ?>" />
                                <p class="description">Los envíos comenzarán desde esta fecha (opcional).</p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="fecha_fin">Fecha de Fin</label></th>
                            <td>
                                <input type="date" name="fecha_fin" id="fecha_fin"
                                    value="<?php echo $editando ? esc_attr($config_edit['fecha_fin']) : ''; ?>" />
                                <p class="description">Los envíos se pausarán después de esta fecha (opcional).</p>
                            </td>
                        </tr>
                    </table>

                    <p class="submit">
                        <?php submit_button($editando ? 'Actualizar Configuración' : 'Crear Configuración', 'primary', 'submit', false); ?>
                        <?php if ($editando): ?>
                            <a href="<?php echo admin_url('admin.php?page=tm-reportes-config'); ?>" class="button button-secondary">Cancelar</a>
                        <?php endif; ?>
                    </p>
                </form>
            </div>

            <!-- === LISTADO DE CONFIGURACIONES EXISTENTES === -->
            <div style="background:#fff;padding:20px;border-radius:5px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                <h2 style="margin-top:0;">📋 Configuraciones Existentes (<?php echo count($configs); ?>)</h2>
                <?php if (empty($configs)): ?>
                    <p>No hay configuraciones creadas todavía.</p>
                <?php else: ?>
                    <table class="wp-list-table widefat fixed striping">
                        <thead>
                            <tr>
                                <th>Curso</th>
                                <th>Institución</th>
                                <th>Coordinador</th>
                                <th>Correo</th>
                                <th>Tipo Reporte</th>
                                <th>Frecuencia</th>
                                <th>Último Envío</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($configs as $config): ?>
                                <tr>
                                    <td>
                                        <strong><?php echo esc_html($config['curso_nombre']); ?></strong>
                                    </td>
                                    <td><?php echo esc_html($config['institucion']); ?></td>
                                    <td><?php echo esc_html($config['nombre_coordinador']); ?></td>
                                    <td><?php echo esc_html($config['correo_coordinador']); ?></td>
                                    <td>
                                        <?php
                                        $tipos = [
                                            'general' => 'Avance General',
                                            'notas'   => 'Calificaciones',
                                            'accesos' => 'Último Acceso',
                                        ];
                                        echo esc_html($tipos[$config['tipo_reporte']] ?? $config['tipo_reporte']);
                                        ?>
                                    </td>
                                    <td>
                                        <?php
                                        $freqs = [
                                            'diario'  => 'Diario',
                                            'semanal' => 'Semanal',
                                            'mensual' => 'Mensual',
                                        ];
                                        echo esc_html($freqs[$config['frecuencia']] ?? $config['frecuencia']);
                                        ?>
                                    </td>
                                    <td>
                                        <?php
                                        if (!empty($config['ultimo_envio'])) {
                                            echo esc_html(date_i18n('d-m-Y H:i', strtotime($config['ultimo_envio'])));
                                        } else {
                                            echo '<span style="color:#999;">Nunca</span>';
                                        }
                                        ?>
                                    </td>
                                    <td>
                                        <a href="<?php echo wp_nonce_url(admin_url('admin.php?page=tm-reportes-config&action=editar&id=' . $config['id']), 'tm_editar_config_' . $config['id']); ?>"
                                            class="button button-small">Editar</a>
                                        <a href="<?php echo wp_nonce_url(admin_url('admin.php?page=tm-reportes-config&action=eliminar&id=' . $config['id']), 'tm_eliminar_config_' . $config['id']); ?>"
                                            class="button button-small button-link-delete"
                                            onclick="return confirm('¿Eliminar esta configuración? Esta acción no se puede deshacer.')">Eliminar</a>
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                <?php endif; ?>
            </div>
        </div>

        <script>
            function tmToggleDiaEnvio() {
                var frecuencia = document.getElementById('frecuencia').value;
                var semanal = document.getElementById('dia_envio_semanal');
                var mensual = document.getElementById('dia_envio_mensual');
                var info = document.getElementById('dia_envio_info');
                var fila = document.getElementById('fila-dia-envio');

                if (frecuencia === 'diario') {
                    fila.style.display = 'none';
                } else {
                    fila.style.display = '';
                    if (frecuencia === 'semanal') {
                        semanal.style.display = '';
                        mensual.style.display = 'none';
                        info.textContent = 'Día de la semana';
                    } else if (frecuencia === 'mensual') {
                        semanal.style.display = 'none';
                        mensual.style.display = '';
                        info.textContent = 'Día del mes';
                    }
                }
            }
            // Ejecutar al cargar
            document.addEventListener('DOMContentLoaded', function() {
                tmToggleDiaEnvio();
            });
        </script>
        <?php
    }

    /**
     * Procesar el formulario de alta o edición
     */
    private function procesar_formulario()
    {
        if (!wp_verify_nonce($_POST['_wpnonce'] ?? '', 'tm_guardar_config')) {
            return '<div class="notice notice-error"><p>Error de seguridad. Intente nuevamente.</p></div>';
        }

        $db = TM_Reportes_DB::get_instance();
        $action = sanitize_text_field($_POST['tm_action']);

        // Recopilar datos del formulario
        $curso_id = intval($_POST['curso_id']);
        $cursos = tm_reportes_obtener_cursos_moodle();
        $curso_nombre = '';
        foreach ($cursos as $c) {
            if (intval($c['id']) === $curso_id) {
                $curso_nombre = $c['fullname'];
                break;
            }
        }

        $frecuencia = sanitize_text_field($_POST['frecuencia']);

        // Determinar día de envío según frecuencia
        if ($frecuencia === 'semanal') {
            $dia_envio = sanitize_text_field($_POST['dia_envio_semanal']);
        } elseif ($frecuencia === 'mensual') {
            $dia_envio = sanitize_text_field($_POST['dia_envio_mensual']);
        } else {
            $dia_envio = 'monday'; // No se usa en diario
        }

        $datos = [
            'institucion'        => $_POST['institucion'],
            'nombre_coordinador' => $_POST['nombre_coordinador'],
            'correo_coordinador' => $_POST['correo_coordinador'],
            'curso_id'           => $curso_id,
            'curso_nombre'       => $curso_nombre,
            'frecuencia'         => $frecuencia,
            'dia_envio'          => $dia_envio,
            'hora_envio'         => sanitize_text_field($_POST['hora_envio']),
            'tipo_reporte'       => sanitize_text_field($_POST['tipo_reporte']),
            'copia_interna'      => $_POST['copia_interna'] ?? '',
            'fecha_inicio'       => $_POST['fecha_inicio'] ?? '',
            'fecha_fin'          => $_POST['fecha_fin'] ?? '',
        ];

        if ($action === 'crear') {
            // Validar que no exista ya una config para este curso
            if ($db->existe_config_curso($curso_id)) {
                return '<div class="notice notice-error"><p>Ya existe una configuración para este curso. Edite la existente.</p></div>';
            }

            $config_id = $db->insertar_config($datos);

            if ($config_id) {
                // Calcular próximo envío
                $scheduler = new TM_Reportes_Scheduler();
                $datos_completos = $datos;
                $datos_completos['id'] = $config_id;
                $proximo = $scheduler->calcular_proximo_envio($datos_completos);
                $db->actualizar_config($config_id, ['proximo_envio' => $proximo]);

                return '<div class="notice notice-success is-dismissible"><p>Configuración creada correctamente. Próximo envío: ' . ($proximo ? date_i18n('d-m-Y H:i', strtotime($proximo)) : 'No programado') . '</p></div>';
            } else {
                return '<div class="notice notice-error"><p>Error al crear la configuración.</p></div>';
            }
        } elseif ($action === 'editar') {
            $config_id = intval($_POST['config_id']);

            // Validar que no exista para otro curso
            if ($db->existe_config_curso($curso_id, $config_id)) {
                return '<div class="notice notice-error"><p>Ya existe otra configuración para este curso.</p></div>';
            }

            $actualizado = $db->actualizar_config($config_id, $datos);

            if ($actualizado) {
                // Recalcular próximo envío
                $scheduler = new TM_Reportes_Scheduler();
                $datos_completos = $datos;
                $datos_completos['id'] = $config_id;
                $proximo = $scheduler->calcular_proximo_envio($datos_completos);
                $db->actualizar_config($config_id, ['proximo_envio' => $proximo]);

                return '<div class="notice notice-success is-dismissible"><p>Configuración actualizada correctamente.</p></div>';
            } else {
                return '<div class="notice notice-error"><p>Error al actualizar la configuración.</p></div>';
            }
        }

        return '';
    }
}
