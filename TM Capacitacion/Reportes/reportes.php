<?php
/**
 * Plugin Name: TM Capacitación - Reportes Avanzados Moodle
 * Description: Panel de administración para consultar y descargar reportes detallados de alumnos desde la BD local de Moodle.
 * Version: 1.0.0
 * Author: Solvitu
 * License: GPL2
 */

if (!defined('ABSPATH')) {
    exit; // Prevenir acceso directo
}

// 1. Crear el menú en el Panel de Administración de WordPress
add_action('admin_menu', 'tm_reportes_moodle_menu');
function tm_reportes_moodle_menu()
{
    add_menu_page(
        'Reportes Moodle',
        'Rep. Moodle',
        'manage_options', // Solo Administradores
        'tm-reportes-moodle',
        'tm_reportes_moodle_render_page',
        'dashicons-analytics',
        25
    );
}

// 2. Helper para obtener la lista de cursos activos en Moodle (para el desplegable)
function tm_reportes_obtener_cursos_moodle()
{
    $cursos = [];

    // Validar que las constantes existan
    if (!defined('TM_MOODLE_DB_HOST'))
        return $cursos;

    $mysqli = new mysqli(TM_MOODLE_DB_HOST, TM_MOODLE_DB_USER, TM_MOODLE_DB_PASS, TM_MOODLE_DB_NAME);
    if ($mysqli->connect_error) {
        error_log("Error de conexión Moodle en Reportes: " . $mysqli->connect_error);
        return $cursos;
    }

    $mysqli->set_charset("utf8mb4");
    $prefix = TM_MOODLE_DB_PREFIX;

    // Traemos los cursos excluyendo el sitio principal (ID 1)
    $sql = "SELECT id, fullname FROM {$prefix}course WHERE id > 1 AND visible = 1 ORDER BY fullname ASC";
    if ($result = $mysqli->query($sql)) {
        while ($row = $result->fetch_assoc()) {
            $cursos[] = $row;
        }
        $result->free();
    }
    $mysqli->close(); // Seguridad: Cierre estricto de conexión
    return $cursos;
}

// Hook para procesar la exportación a Excel antes de enviar headers
add_action('admin_init', 'tm_reportes_exportar_excel');
function tm_reportes_exportar_excel()
{
    if (isset($_POST['download_excel']) && isset($_POST['tm_curso_id']) && isset($_POST['tm_tipo_reporte'])) {
        $curso_seleccionado = intval($_POST['tm_curso_id']);
        $vista_seleccionada = sanitize_text_field($_POST['tm_tipo_reporte']);

        if ($curso_seleccionado > 0 && in_array($vista_seleccionada, ['notas', 'accesos'])) {
            $datos = tm_reportes_obtener_datos_curso($curso_seleccionado, $vista_seleccionada);

            header('Content-Type: text/csv; charset=utf-8');
            header('Content-Disposition: attachment; filename=reporte_' . $vista_seleccionada . '_' . date('Ymd') . '.csv');

            $output = fopen('php://output', 'w');
            // Añadir BOM para que Excel lea UTF-8 correctamente
            fputs($output, "\xEF\xBB\xBF");

            if ($vista_seleccionada === 'accesos') {
                fputcsv($output, ['RUT', 'Nombre', 'Apellido', 'Correo', 'Ultimo Acceso'], ';');
                foreach ($datos as $alumno) {
                    fputcsv($output, [
                        $alumno['rut'],
                        $alumno['nombre'],
                        $alumno['apellido'],
                        $alumno['correo'],
                        $alumno['ultimo_acceso_humano']
                    ], ';');
                }
            } elseif ($vista_seleccionada === 'notas') {
                $cabeceras = ['RUT', 'Nombre', 'Apellido', 'Correo'];
                if (!empty($datos['actividades'])) {
                    foreach ($datos['actividades'] as $act_name) {
                        $cabeceras[] = $act_name;
                    }
                }
                fputcsv($output, $cabeceras, ';');

                foreach ($datos['alumnos'] as $alumno) {
                    $fila = [
                        $alumno['rut'],
                        $alumno['nombre'],
                        $alumno['apellido'],
                        $alumno['correo']
                    ];
                    if (!empty($datos['actividades'])) {
                        foreach ($datos['actividades'] as $act_id => $act_name) {
                            $nota = isset($alumno['notas_parciales'][$act_id]) ? $alumno['notas_parciales'][$act_id] : '-';
                            $fila[] = $nota;
                        }
                    }
                    fputcsv($output, $fila, ';');
                }
            }
            fclose($output);
            exit;
        }
    }
}

// 3. Helper para ejecutar la Query Maestra de Datos Cruzados y su Enrutamiento
function tm_reportes_obtener_datos_curso($curso_id, $vista = 'general')
{
    $datos = [];
    if (!defined('TM_MOODLE_DB_HOST') || empty($curso_id))
        return $datos;

    $mysqli = new mysqli(TM_MOODLE_DB_HOST, TM_MOODLE_DB_USER, TM_MOODLE_DB_PASS, TM_MOODLE_DB_NAME);
    if ($mysqli->connect_error)
        return $datos;

    $mysqli->set_charset("utf8mb4");
    $prefix = TM_MOODLE_DB_PREFIX;

    if ($vista === 'general' || $vista === 'individual') {
        $sql = "SELECT 
                    u.id as userid,
                    u.idnumber AS rut,
                    u.firstname AS nombre,
                    u.lastname AS apellido,
                    u.email AS correo,
                    u.lastaccess AS ultimo_acceso_unix,
                    ROUND(gg.finalgrade, 1) AS nota_final,
                    (SELECT COUNT(cmc.id) 
                     FROM {$prefix}course_modules cm
                     JOIN {$prefix}course_modules_completion cmc ON cmc.coursemoduleid = cm.id
                     WHERE cm.course = c.id AND cmc.userid = u.id AND cmc.completionstate = 1) AS actividades_completadas,
                    (SELECT COUNT(cm.id) 
                     FROM {$prefix}course_modules cm
                     WHERE cm.course = c.id AND cm.completion > 0) AS total_actividades
                FROM {$prefix}user u
                JOIN {$prefix}user_enrolments ue ON ue.userid = u.id
                JOIN {$prefix}enrol e ON e.id = ue.enrolid
                JOIN {$prefix}course c ON c.id = e.courseid
                LEFT JOIN {$prefix}grade_items gi ON gi.courseid = c.id AND gi.itemtype = 'course'
                LEFT JOIN {$prefix}grade_grades gg ON gg.itemid = gi.id AND gg.userid = u.id
                WHERE c.id = ? AND u.deleted = 0";

        if ($stmt = $mysqli->prepare($sql)) {
            $stmt->bind_param("i", $curso_id);
            $stmt->execute();
            $result = $stmt->get_result();

            while ($row = $result->fetch_assoc()) {
                $total = intval($row['total_actividades']);
                $comp = intval($row['actividades_completadas']);
                $row['progreso'] = ($total > 0) ? round(($comp / $total) * 100, 1) : 0;
                $datos[] = $row;
            }
            $stmt->close();
        }
    } elseif ($vista === 'accesos') {
        $sql = "SELECT 
                    u.idnumber AS rut,
                    u.firstname AS nombre,
                    u.lastname AS apellido,
                    u.email AS correo,
                    u.lastaccess AS ultimo_acceso_unix
                FROM {$prefix}user u
                JOIN {$prefix}user_enrolments ue ON ue.userid = u.id
                JOIN {$prefix}enrol e ON e.id = ue.enrolid
                JOIN {$prefix}course c ON c.id = e.courseid
                WHERE c.id = ? AND u.deleted = 0";

        if ($stmt = $mysqli->prepare($sql)) {
            $stmt->bind_param("i", $curso_id);
            $stmt->execute();
            $result = $stmt->get_result();

            while ($row = $result->fetch_assoc()) {
                $valor_unix = intval($row['ultimo_acceso_unix']);
                if ($valor_unix === 0) {
                    $row['ultimo_acceso_humano'] = 'Nunca';
                } else {
                    $row['ultimo_acceso_humano'] = date_i18n('d-m-Y H:i', $valor_unix);
                }
                $datos[] = $row;
            }
            $stmt->close();
        }
    } elseif ($vista === 'notas') {
        // Paso 1: Traer ítems de calificación (actividades)
        $actividades = [];
        $sql_items = "SELECT id, itemname FROM {$prefix}grade_items WHERE courseid = ? AND itemtype = 'mod' ORDER BY id ASC";
        if ($stmt_items = $mysqli->prepare($sql_items)) {
            $stmt_items->bind_param("i", $curso_id);
            $stmt_items->execute();
            $res_items = $stmt_items->get_result();
            while ($row_item = $res_items->fetch_assoc()) {
                $actividades[$row_item['id']] = $row_item['itemname'];
            }
            $stmt_items->close();
        }

        // Paso 2: Traer todas las notas de este curso (Optimizado)
        $notas_curso = [];
        $sql_todas_notas = "SELECT gg.userid, gg.itemid, gg.finalgrade 
                            FROM {$prefix}grade_grades gg
                            JOIN {$prefix}grade_items gi ON gi.id = gg.itemid
                            WHERE gi.courseid = ? AND gi.itemtype = 'mod'";
        if ($stmt_notas = $mysqli->prepare($sql_todas_notas)) {
            $stmt_notas->bind_param("i", $curso_id);
            $stmt_notas->execute();
            $res_notas = $stmt_notas->get_result();
            while ($nota = $res_notas->fetch_assoc()) {
                $notas_curso[$nota['userid']][$nota['itemid']] = round($nota['finalgrade'], 1);
            }
            $stmt_notas->close();
        }

        $datos['actividades'] = $actividades;
        $datos['alumnos'] = [];

        // Paso 3: Traer alumnos y cruzar con sus notas en PHP
        $sql_alumnos = "SELECT 
                    u.id as userid,
                    u.idnumber AS rut,
                    u.firstname AS nombre,
                    u.lastname AS apellido,
                    u.email AS correo
                FROM {$prefix}user u
                JOIN {$prefix}user_enrolments ue ON ue.userid = u.id
                JOIN {$prefix}enrol e ON e.id = ue.enrolid
                JOIN {$prefix}course c ON c.id = e.courseid
                WHERE c.id = ? AND u.deleted = 0";

        if ($stmt_alumnos = $mysqli->prepare($sql_alumnos)) {
            $stmt_alumnos->bind_param("i", $curso_id);
            $stmt_alumnos->execute();
            $res_alumnos = $stmt_alumnos->get_result();

            while ($alumno = $res_alumnos->fetch_assoc()) {
                $userid = $alumno['userid'];
                $alumno['notas_parciales'] = isset($notas_curso[$userid]) ? $notas_curso[$userid] : [];
                $datos['alumnos'][] = $alumno;
            }
            $stmt_alumnos->close();
        }
    }

    $mysqli->close(); // Seguridad: Cierre estricto de conexión
    return $datos;
}

// 4. Renderizado de la Interfaz en WordPress
function tm_reportes_moodle_render_page()
{
    $cursos = tm_reportes_obtener_cursos_moodle();
    $curso_seleccionado = isset($_POST['tm_curso_id']) ? intval($_POST['tm_curso_id']) : 0;
    $vista_seleccionada = isset($_POST['tm_tipo_reporte']) ? sanitize_text_field($_POST['tm_tipo_reporte']) : 'general';
    $datos_reporte = [];

    if ($curso_seleccionado > 0) {
        $datos_reporte = tm_reportes_obtener_datos_curso($curso_seleccionado, $vista_seleccionada);
    }

    // Si la vista es notas, alumnos está en $datos_reporte['alumnos'], de lo contrario en $datos_reporte
    $alumnos = ($vista_seleccionada === 'notas' && isset($datos_reporte['alumnos'])) ? $datos_reporte['alumnos'] : $datos_reporte;
    ?>
    <div class="wrap">
        <h1>📊 Sistema de Reportes</h1>
        <p>Elige el curso, el tipo de reporte y revisa los resultados en tiempo real.</p>
        <hr />

        <style>
            @media print {

                /* Ocultar todo el entorno de WordPress */
                #adminmenumain,
                #wpadminbar,
                .notice,
                form,
                .btn-imprimir,
                .update-nag,
                .components-notice-list {
                    display: none !important;
                }

                /* Ajustar el contenedor principal */
                #wpcontent,
                #wpbody {
                    margin-left: 0 !important;
                    padding: 0 !important;
                }

                .wrap {
                    background: #fff;
                    padding: 0;
                }

                /* Forzar saltos de página */
                .ficha-alumno {
                    page-break-after: always;
                    padding: 20px;
                    border: 1px solid #ccc;
                    margin-bottom: 20px;
                    border-radius: 8px;
                }

                .no-print {
                    display: none !important;
                }
            }

            .ficha-alumno {
                background: #fff;
                padding: 20px;
                border: 1px solid #ddd;
                margin-bottom: 20px;
                border-radius: 8px;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
            }

            .ficha-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #eee;
                padding-bottom: 10px;
                margin-bottom: 15px;
            }

            .ficha-titulo {
                font-size: 1.2em;
                font-weight: bold;
            }

            .progreso-container {
                background: #f0f0f1;
                width: 100%;
                height: 12px;
                border-radius: 6px;
                margin-top: 10px;
                overflow: hidden;
            }

            .progreso-barra {
                background: #0073aa;
                height: 12px;
                border-radius: 6px;
                transition: width 0.3s;
            }
        </style>

        <form method="post"
            style="margin-bottom: 20px; background: #fff; padding: 15px; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <label for="tm_curso_id" style="font-weight: bold; margin-right: 10px;">Selecciona el Curso:</label>
            <select name="tm_curso_id" id="tm_curso_id" style="min-width: 250px; padding: 5px; margin-right: 15px;">
                <option value="">-- Seleccione un Curso --</option>
                <?php foreach ($cursos as $curso): ?>
                    <option value="<?php echo $curso['id']; ?>" <?php selected($curso_seleccionado, $curso['id']); ?>>
                        <?php echo esc_html($curso['fullname']); ?>
                    </option>
                <?php endforeach; ?>
            </select>

            <label for="tm_tipo_reporte" style="font-weight: bold; margin-right: 10px;">Tipo de Informe:</label>
            <select name="tm_tipo_reporte" id="tm_tipo_reporte" style="min-width: 250px; padding: 5px;">
                <option value="general" <?php selected($vista_seleccionada, 'general'); ?>>Informe General de Avance (PDF)
                </option>
                <option value="individual" <?php selected($vista_seleccionada, 'individual'); ?>>Fichas de Progreso
                    Individuales (PDF)</option>
                <option value="notas" <?php selected($vista_seleccionada, 'notas'); ?>>Matriz de Calificaciones Parciales
                    (Excel)</option>
                <option value="accesos" <?php selected($vista_seleccionada, 'accesos'); ?>>Auditoría de Últimos Accesos
                    (Excel)</option>
            </select>

            <?php submit_button('Generar Reporte', 'primary', 'submit', false, ['style' => 'margin-left: 10px; vertical-align: top;']); ?>

            <?php if ($curso_seleccionado > 0): ?>
                <?php if (in_array($vista_seleccionada, ['general', 'individual'])): ?>
                    <button type="button" class="button button-secondary btn-imprimir" onclick="window.print()"
                        style="margin-left: 10px; vertical-align: top;"><span class="dashicons dashicons-printer"></span> Imprimir
                        PDF</button>
                <?php else: ?>
                    <button type="submit" name="download_excel" value="1" class="button button-secondary btn-imprimir"
                        style="margin-left: 10px; vertical-align: top;"><span class="dashicons dashicons-media-spreadsheet"></span>
                        Descargar Excel</button>
                <?php endif; ?>
            <?php endif; ?>
        </form>

        <?php if ($curso_seleccionado > 0): ?>
            <h3 class="no-print">Resultados del Reporte (<?php echo count($alumnos); ?> alumnos encontrados)</h3>

            <?php if ($vista_seleccionada === 'general'): ?>
                <!-- Vista: General -->
                <div class="kpis-container" style="display: flex; gap: 20px; margin-bottom: 20px;">
                    <?php
                    $suma_notas = 0;
                    $suma_progreso = 0;
                    $alumnos_criticos = 0;
                    $total_alumnos = count($alumnos);
                    if ($total_alumnos > 0) {
                        foreach ($alumnos as $al) {
                            $suma_notas += floatval($al['nota_final']);
                            $suma_progreso += floatval($al['progreso']);
                            if ($al['ultimo_acceso_unix'] == 0 || (time() - $al['ultimo_acceso_unix']) / DAY_IN_SECONDS > 7) {
                                $alumnos_criticos++;
                            }
                        }
                    }
                    ?>
                    <div
                        style="flex: 1; background: #fff; padding: 15px; border-left: 4px solid #0073aa; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
                        <h4 style="margin: 0 0 5px 0;">Promedio General</h4>
                        <span
                            style="font-size: 24px; font-weight: bold;"><?php echo $total_alumnos > 0 ? round($suma_notas / $total_alumnos, 1) : 0; ?></span>
                    </div>
                    <div
                        style="flex: 1; background: #fff; padding: 15px; border-left: 4px solid #46b450; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
                        <h4 style="margin: 0 0 5px 0;">Avance del Grupo</h4>
                        <span
                            style="font-size: 24px; font-weight: bold;"><?php echo $total_alumnos > 0 ? round($suma_progreso / $total_alumnos, 1) : 0; ?>%</span>
                    </div>
                    <div
                        style="flex: 1; background: #fff; padding: 15px; border-left: 4px solid #dc3232; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
                        <h4 style="margin: 0 0 5px 0;">Alumnos en Riesgo</h4>
                        <span style="font-size: 24px; font-weight: bold;"><?php echo $alumnos_criticos; ?></span>
                    </div>
                </div>

                <table class="wp-list-table widefat fixed striping">
                    <thead>
                        <tr>
                            <th>RUT</th>
                            <th>Alumno</th>
                            <th>Correo</th>
                            <th>% Progreso</th>
                            <th>Nota Final</th>
                            <th>Estado de Alerta</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php if (empty($alumnos)): ?>
                            <tr>
                                <td colspan="6">No hay alumnos matriculados en este curso.</td>
                            </tr>
                        <?php else: ?>
                            <?php foreach ($alumnos as $alumno):
                                $alerta = '🟢 Activo';
                                $estilo_alerta = 'color: #46b450; font-weight: bold;';

                                if ($alumno['ultimo_acceso_unix'] == 0) {
                                    $alerta = '🔴 Nunca ha ingresado';
                                    $estilo_alerta = 'color: #dc3232; font-weight: bold;';
                                } else {
                                    $dias_inactivo = (time() - $alumno['ultimo_acceso_unix']) / DAY_IN_SECONDS;
                                    if ($dias_inactivo > 7) {
                                        $alerta = '🔴 En Riesgo (>7d)';
                                        $estilo_alerta = 'color: #dc3232; font-weight: bold;';
                                    } elseif ($dias_inactivo > 3) {
                                        $alerta = '🟡 Ausente (>3d)';
                                        $estilo_alerta = 'color: #ffb900; font-weight: bold;';
                                    }
                                }
                                ?>
                                <tr>
                                    <td><?php echo esc_html($alumno['rut'] ? $alumno['rut'] : 'N/A'); ?></td>
                                    <td><?php echo esc_html($alumno['nombre'] . ' ' . $alumno['apellido']); ?></td>
                                    <td><?php echo esc_html($alumno['correo']); ?></td>
                                    <td>
                                        <strong><?php echo $alumno['progreso']; ?>%</strong>
                                        <div class="progreso-container">
                                            <div class="progreso-barra" style="width: <?php echo $alumno['progreso']; ?>%;"></div>
                                        </div>
                                    </td>
                                    <td><strong><?php echo $alumno['nota_final'] ? $alumno['nota_final'] : '0.0'; ?></strong></td>
                                    <td style="<?php echo $estilo_alerta; ?>"><?php echo $alerta; ?></td>
                                </tr>
                            <?php endforeach; ?>
                        <?php endif; ?>
                    </tbody>
                </table>

            <?php elseif ($vista_seleccionada === 'individual'): ?>
                <!-- Vista: Individual -->
                <?php if (empty($alumnos)): ?>
                    <p>No hay alumnos matriculados en este curso.</p>
                <?php else: ?>
                    <div style="max-width: 800px; margin: 0 auto;">
                        <?php foreach ($alumnos as $alumno): ?>
                            <div class="ficha-alumno">
                                <div class="ficha-header">
                                    <div class="ficha-titulo"><?php echo esc_html($alumno['nombre'] . ' ' . $alumno['apellido']); ?></div>
                                    <div><strong>RUT:</strong> <?php echo esc_html($alumno['rut'] ? $alumno['rut'] : 'N/A'); ?></div>
                                </div>
                                <div style="margin-bottom: 15px;">
                                    <strong>Correo:</strong> <?php echo esc_html($alumno['correo']); ?> <br />
                                    <strong>Nota Final Actual:</strong> <span
                                        style="font-size: 1.2em; color: #0073aa; font-weight: bold;"><?php echo $alumno['nota_final'] ? $alumno['nota_final'] : '0.0'; ?></span>
                                </div>
                                <div>
                                    <strong>Progreso del Curso: <?php echo $alumno['progreso']; ?>%</strong>
                                    (<?php echo $alumno['actividades_completadas']; ?>/<?php echo $alumno['total_actividades']; ?>
                                    actividades)
                                    <div class="progreso-container" style="height: 18px; border-radius: 9px;">
                                        <div class="progreso-barra"
                                            style="width: <?php echo $alumno['progreso']; ?>%; height: 18px; border-radius: 9px; background: <?php echo ($alumno['progreso'] == 100) ? '#46b450' : '#0073aa'; ?>;">
                                        </div>
                                    </div>
                                </div>
                                <div style="margin-top: 15px; font-size: 0.9em; color: #666;">
                                    <em>Último acceso al curso:
                                        <?php echo ($alumno['ultimo_acceso_unix'] > 0) ? date_i18n('d-m-Y H:i', $alumno['ultimo_acceso_unix']) : 'Nunca'; ?></em>
                                </div>
                            </div>
                        <?php endforeach; ?>
                    </div>
                <?php endif; ?>

            <?php elseif ($vista_seleccionada === 'notas'): ?>
                <!-- Vista: Notas -->
                <div style="overflow-x: auto;">
                    <table class="wp-list-table widefat fixed striping" style="min-width: 1000px;">
                        <thead>
                            <tr>
                                <th style="width: 10%;">RUT</th>
                                <th style="width: 15%;">Alumno</th>
                                <?php if (!empty($datos_reporte['actividades'])): ?>
                                    <?php foreach ($datos_reporte['actividades'] as $act_name): ?>
                                        <th style="width: auto;"><?php echo esc_html($act_name); ?></th>
                                    <?php endforeach; ?>
                                <?php else: ?>
                                    <th>Sin actividades calificables evaluadas</th>
                                <?php endif; ?>
                            </tr>
                        </thead>
                        <tbody>
                            <?php if (empty($alumnos)): ?>
                                <tr>
                                    <td colspan="100%">No hay alumnos matriculados en este curso.</td>
                                </tr>
                            <?php else: ?>
                                <?php foreach ($alumnos as $alumno): ?>
                                    <tr>
                                        <td><?php echo esc_html($alumno['rut'] ? $alumno['rut'] : 'N/A'); ?></td>
                                        <td><?php echo esc_html($alumno['nombre'] . ' ' . $alumno['apellido']); ?></td>
                                        <?php if (!empty($datos_reporte['actividades'])): ?>
                                            <?php foreach ($datos_reporte['actividades'] as $act_id => $act_name): ?>
                                                <td><?php echo isset($alumno['notas_parciales'][$act_id]) ? esc_html($alumno['notas_parciales'][$act_id]) : '-'; ?>
                                                </td>
                                            <?php endforeach; ?>
                                        <?php else: ?>
                                            <td>-</td>
                                        <?php endif; ?>
                                    </tr>
                                <?php endforeach; ?>
                            <?php endif; ?>
                        </tbody>
                    </table>
                </div>

            <?php elseif ($vista_seleccionada === 'accesos'): ?>
                <!-- Vista: Accesos -->
                <table class="wp-list-table widefat fixed striping">
                    <thead>
                        <tr>
                            <th>RUT</th>
                            <th>Alumno</th>
                            <th>Correo</th>
                            <th>Último Acceso</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php if (empty($alumnos)): ?>
                            <tr>
                                <td colspan="4">No hay alumnos matriculados en este curso.</td>
                            </tr>
                        <?php else: ?>
                            <?php foreach ($alumnos as $alumno): ?>
                                <tr>
                                    <td><?php echo esc_html($alumno['rut'] ? $alumno['rut'] : 'N/A'); ?></td>
                                    <td><?php echo esc_html($alumno['nombre'] . ' ' . $alumno['apellido']); ?></td>
                                    <td><?php echo esc_html($alumno['correo']); ?></td>
                                    <td>
                                        <?php
                                        if ($alumno['ultimo_acceso_humano'] === 'Nunca') {
                                            echo '<span style="color: #dc3232; font-weight: bold;">Nunca</span>';
                                        } else {
                                            echo esc_html($alumno['ultimo_acceso_humano']);
                                        }
                                        ?>
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                        <?php endif; ?>
                    </tbody>
                </table>

            <?php endif; ?>

        <?php endif; ?>
    </div>
    <?php
}