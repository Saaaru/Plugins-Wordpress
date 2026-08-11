<?php
/**
 * Plugin Name: TM Capacitación - Reportes Avanzados Moodle
 * Description: Panel de administración para consultar, descargar y automatizar el envío de reportes de alumnos desde la BD local de Moodle.
 * Version: 3.0.0
 * Author: Solvitu
 * License: GPL2
 */

if (!defined('ABSPATH')) {
    exit; // Prevenir acceso directo
}

// Definir constantes del plugin
define('TM_REPORTES_VERSION', '3.0.0');
define('TM_REPORTES_PATH', plugin_dir_path(__FILE__));
define('TM_REPORTES_URL', plugin_dir_url(__FILE__));

// === CARGAR MÓDULOS DE AUTOMATIZACIÓN ===
require_once TM_REPORTES_PATH . 'includes/class-db.php';
require_once TM_REPORTES_PATH . 'includes/class-scheduler.php';
require_once TM_REPORTES_PATH . 'includes/class-mailer.php';
require_once TM_REPORTES_PATH . 'includes/class-admin-config.php';
require_once TM_REPORTES_PATH . 'includes/class-admin-panel.php';

// === HOOK DE ACTIVACIÓN: Crear tablas y registrar cron ===
register_activation_hook(__FILE__, 'tm_reportes_activar');
function tm_reportes_activar()
{
    // Crear tablas de automatización
    $db = TM_Reportes_DB::get_instance();
    $db->crear_tablas();

    // Registrar WP-Cron
    $scheduler = new TM_Reportes_Scheduler();
    $scheduler->activar_cron();
}

// === HOOK DE DESACTIVACIÓN: Eliminar cron ===
register_deactivation_hook(__FILE__, 'tm_reportes_desactivar');
function tm_reportes_desactivar()
{
    $scheduler = new TM_Reportes_Scheduler();
    $scheduler->desactivar_cron();
}

// === INICIALIZAR SCHEDULER (cron hook + intervalo) ===
$scheduler_init = new TM_Reportes_Scheduler();
$scheduler_init->init();

// === FALLBACK: Crear tablas y cron si no se ejecutó el activation hook ===
// (cuando el plugin se actualiza copiando archivos en vez de activarlo desde WP)
add_action('admin_init', 'tm_reportes_verificar_instalacion');
function tm_reportes_verificar_instalacion()
{
    $version_instalada = get_option('tm_reportes_db_version', '0');

    if ($version_instalada !== TM_REPORTES_VERSION) {
        // Crear/actualizar tablas
        $db = TM_Reportes_DB::get_instance();
        $db->crear_tablas();

        // Asegurar que el cron esté registrado
        $scheduler = new TM_Reportes_Scheduler();
        $scheduler->activar_cron();
    }
}

// 1. Crear el menú y submenús en el Panel de Administración de WordPress
add_action('admin_menu', 'tm_reportes_moodle_menu');
function tm_reportes_moodle_menu()
{
    // Menú principal: Reportes
    add_menu_page(
        'Reportes Moodle',
        'Rep. Moodle',
        'manage_options',
        'tm-reportes-moodle',
        'tm_reportes_moodle_render_page',
        'dashicons-analytics',
        25
    );

    // Submenú: Reportes (mismo que el principal, para que aparezca como primer item)
    add_submenu_page(
        'tm-reportes-moodle',
        'Generar Reportes',
        '📊 Generar Reportes',
        'manage_options',
        'tm-reportes-moodle',
        'tm_reportes_moodle_render_page'
    );

    // Submenú: Configuración de Coordinadores
    add_submenu_page(
        'tm-reportes-moodle',
        'Configuración de Coordinadores',
        '⚙️ Configuración',
        'manage_options',
        'tm-reportes-config',
        ['TM_Reportes_Admin_Config', 'render_static']
    );

    // Submenú: Panel de Programación
    add_submenu_page(
        'tm-reportes-moodle',
        'Panel de Programación',
        '📅 Programación',
        'manage_options',
        'tm-reportes-panel',
        ['TM_Reportes_Admin_Panel', 'render_panel_static']
    );

    // Submenú: Historial de Envíos
    add_submenu_page(
        'tm-reportes-moodle',
        'Historial de Envíos',
        '📜 Historial',
        'manage_options',
        'tm-reportes-historial',
        ['TM_Reportes_Admin_Panel', 'render_historial_static']
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

            // Aplicar ordenamiento por defecto en el export
            if ($vista_seleccionada === 'accesos' && is_array($datos)) {
                usort($datos, function ($a, $b) {
                    $aAccess = intval($a['ultimo_acceso_unix']);
                    $bAccess = intval($b['ultimo_acceso_unix']);
                    // Nunca primero, luego por fecha ascendente (más inactivo arriba)
                    if ($aAccess === 0 && $bAccess === 0) {
                        return strcasecmp($a['nombre'] . ' ' . $a['apellido'], $b['nombre'] . ' ' . $b['apellido']);
                    }
                    if ($aAccess === 0)
                        return -1;
                    if ($bAccess === 0)
                        return 1;
                    return $aAccess - $bAccess;
                });
            }

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
                // Ordenar alumnos por nombre en el export
                if (!empty($datos['alumnos'])) {
                    usort($datos['alumnos'], function ($a, $b) {
                        return strcasecmp($a['nombre'] . ' ' . $a['apellido'], $b['nombre'] . ' ' . $b['apellido']);
                    });
                }

                $cabeceras = ['RUT', 'Nombre', 'Apellido', 'Correo'];
                if (!empty($datos['actividades'])) {
                    foreach ($datos['actividades'] as $act_name) {
                        $cabeceras[] = $act_name;
                    }
                }
                $cabeceras[] = 'Total del Curso'; // Nueva columna
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
                    $fila[] = isset($alumno['nota_total_curso']) ? $alumno['nota_total_curso'] : '-';
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

    if ($vista === 'general') {
        // FIX: completionstate IN (1, 2) para contar tanto "complete" como "complete_pass"
        // FIX: GROUP BY u.id para evitar duplicados por múltiples métodos de enrolamiento
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
                     WHERE cm.course = c.id AND cmc.userid = u.id AND cmc.completionstate IN (1, 2)) AS actividades_completadas,
                    (SELECT COUNT(cm.id) 
                     FROM {$prefix}course_modules cm
                     WHERE cm.course = c.id AND cm.completion > 0) AS total_actividades
                FROM {$prefix}user u
                JOIN {$prefix}user_enrolments ue ON ue.userid = u.id
                JOIN {$prefix}enrol e ON e.id = ue.enrolid
                JOIN {$prefix}course c ON c.id = e.courseid
                LEFT JOIN {$prefix}grade_items gi ON gi.courseid = c.id AND gi.itemtype = 'course'
                LEFT JOIN {$prefix}grade_grades gg ON gg.itemid = gi.id AND gg.userid = u.id
                WHERE c.id = ? AND u.deleted = 0
                GROUP BY u.id";

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
                WHERE c.id = ? AND u.deleted = 0
                GROUP BY u.id";

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

        // Paso 2b: Traer la nota total del curso (itemtype = 'course')
        $notas_totales = [];
        $sql_total = "SELECT gg.userid, gg.finalgrade 
                      FROM {$prefix}grade_grades gg
                      JOIN {$prefix}grade_items gi ON gi.id = gg.itemid
                      WHERE gi.courseid = ? AND gi.itemtype = 'course'";
        if ($stmt_total = $mysqli->prepare($sql_total)) {
            $stmt_total->bind_param("i", $curso_id);
            $stmt_total->execute();
            $res_total = $stmt_total->get_result();
            while ($row_total = $res_total->fetch_assoc()) {
                $notas_totales[$row_total['userid']] = round($row_total['finalgrade'], 1);
            }
            $stmt_total->close();
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
                WHERE c.id = ? AND u.deleted = 0
                GROUP BY u.id";

        if ($stmt_alumnos = $mysqli->prepare($sql_alumnos)) {
            $stmt_alumnos->bind_param("i", $curso_id);
            $stmt_alumnos->execute();
            $res_alumnos = $stmt_alumnos->get_result();

            while ($alumno = $res_alumnos->fetch_assoc()) {
                $userid = $alumno['userid'];
                $alumno['notas_parciales'] = isset($notas_curso[$userid]) ? $notas_curso[$userid] : [];
                $alumno['nota_total_curso'] = isset($notas_totales[$userid]) ? $notas_totales[$userid] : '-';
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

    // === APLICAR ORDENAMIENTO POR DEFECTO ===
    if ($vista_seleccionada === 'general' && is_array($alumnos) && count($alumnos) > 1) {
        usort($alumnos, function ($a, $b) {
            return strcasecmp($a['nombre'] . ' ' . $a['apellido'], $b['nombre'] . ' ' . $b['apellido']);
        });
    } elseif ($vista_seleccionada === 'accesos' && is_array($alumnos) && count($alumnos) > 1) {
        usort($alumnos, function ($a, $b) {
            $aAccess = intval($a['ultimo_acceso_unix']);
            $bAccess = intval($b['ultimo_acceso_unix']);
            // Nunca primero, luego por fecha ascendente (más inactivo arriba)
            if ($aAccess === 0 && $bAccess === 0) {
                return strcasecmp($a['nombre'] . ' ' . $a['apellido'], $b['nombre'] . ' ' . $b['apellido']);
            }
            if ($aAccess === 0)
                return -1;
            if ($bAccess === 0)
                return 1;
            return $aAccess - $bAccess;
        });
    } elseif ($vista_seleccionada === 'notas' && is_array($alumnos) && count($alumnos) > 1) {
        usort($alumnos, function ($a, $b) {
            return strcasecmp($a['nombre'] . ' ' . $a['apellido'], $b['nombre'] . ' ' . $b['apellido']);
        });
    }
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
                .components-notice-list,
                .no-print {
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

            /* Estilos del buscador de cursos */
            .tm-curso-buscar-wrap {
                position: relative;
                display: inline-block;
                margin-right: 15px;
            }

            .tm-curso-buscar-wrap input {
                min-width: 250px;
                padding: 5px 30px 5px 10px;
                box-sizing: border-box;
            }

            .tm-curso-buscar-wrap .dashicons-search {
                position: absolute;
                right: 8px;
                top: 50%;
                transform: translateY(-50%);
                color: #999;
                pointer-events: none;
            }

            /* Estilos de columnas sortables */
            th.sortable {
                cursor: pointer;
                user-select: none;
                position: relative;
                padding-right: 22px !important;
            }

            th.sortable:hover {
                background: #f0f0f1 !important;
            }

            th.sortable .sort-indicator {
                position: absolute;
                right: 6px;
                top: 50%;
                transform: translateY(-50%);
                font-size: 0.75em;
                color: #999;
            }

            th.sortable[data-sort-dir="asc"] .sort-indicator {
                color: #0073aa;
            }

            th.sortable[data-sort-dir="desc"] .sort-indicator {
                color: #0073aa;
            }

            /* KPIs responsive */
            .kpis-container {
                display: flex;
                flex-wrap: wrap;
                gap: 15px;
                margin-bottom: 20px;
            }

            .kpi-box {
                flex: 1;
                min-width: 180px;
                background: #fff;
                padding: 15px;
                border-left: 4px solid #0073aa;
                border-radius: 4px;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
            }

            .kpi-box h4 {
                margin: 0 0 5px 0;
                font-size: 0.9em;
                color: #666;
            }

            .kpi-box .kpi-value {
                font-size: 24px;
                font-weight: bold;
            }
        </style>

        <form method="post"
            style="margin-bottom: 20px; background: #fff; padding: 15px; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

            <!-- BUSCADOR DE CURSO + SELECT -->
            <label for="tm_curso_buscar" style="font-weight: bold; margin-right: 10px;">Selecciona el Curso:</label>
            <div class="tm-curso-buscar-wrap" style="margin-right: 15px;">
                <input type="text" id="tm_curso_buscar" placeholder="Escriba para buscar curso..."
                    onkeyup="tmFiltrarCursos()" autocomplete="off" />
                <span class="dashicons dashicons-search"></span>
            </div>
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
                <option value="general" <?php selected($vista_seleccionada, 'general'); ?>>Informe General de Avance
                    (PDF)</option>
                <option value="notas" <?php selected($vista_seleccionada, 'notas'); ?>>Matriz de Calificaciones Parciales
                    (Excel)</option>
                <option value="accesos" <?php selected($vista_seleccionada, 'accesos'); ?>>Auditoría de Últimos Accesos
                    (Excel)</option>
            </select>

            <?php submit_button('Generar Reporte', 'primary', 'submit', false, ['style' => 'margin-left: 10px; vertical-align: top;']); ?>

            <?php if ($curso_seleccionado > 0): ?>
                <?php if ($vista_seleccionada === 'general'): ?>
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
                <div class="kpis-container">
                    <?php
                    $suma_notas = 0;
                    $suma_progreso = 0;
                    $alumnos_criticos = 0;
                    $total_ingresaron = 0;
                    $total_nunca = 0;
                    $total_100 = 0;
                    $total_alumnos = count($alumnos);
                    if ($total_alumnos > 0) {
                        foreach ($alumnos as $al) {
                            $suma_notas += floatval($al['nota_final']);
                            $suma_progreso += floatval($al['progreso']);

                            $progreso = floatval($al['progreso']);
                            $ultimo = intval($al['ultimo_acceso_unix']);

                            // Conteo de accesos
                            if ($ultimo == 0) {
                                $total_nunca++;
                            } else {
                                $total_ingresaron++;
                            }

                            // Progreso 100%
                            if ($progreso >= 100) {
                                $total_100++;
                            }

                            // === NUEVO CÁLCULO DE ALUMNOS EN RIESGO ===
                            // Un alumno está en riesgo si cumple CUALQUIERA de estas condiciones:
                            // 1. Progreso < 100% Y no se ha conectado en más de 7 días
                            // 2. Nunca ha ingresado
                            // 3. Progreso < 50%
                            $en_riesgo = false;

                            if ($ultimo == 0) {
                                // Condición 2: Nunca ha ingresado
                                $en_riesgo = true;
                            } elseif ($progreso < 100 && (time() - $ultimo) / DAY_IN_SECONDS > 7) {
                                // Condición 1: Progreso incompleto + inactivo >7 días
                                $en_riesgo = true;
                            }

                            if ($progreso < 50) {
                                // Condición 3: Progreso crítico < 50%
                                $en_riesgo = true;
                            }

                            if ($en_riesgo) {
                                $alumnos_criticos++;
                            }
                        }
                    }
                    ?>
                    <div class="kpi-box" style="border-left-color: #0073aa;">
                        <h4>Promedio General</h4>
                        <span
                            class="kpi-value"><?php echo $total_alumnos > 0 ? round($suma_notas / $total_alumnos, 1) : 0; ?></span>
                    </div>
                    <div class="kpi-box" style="border-left-color: #46b450;">
                        <h4>Avance del Grupo</h4>
                        <span
                            class="kpi-value"><?php echo $total_alumnos > 0 ? round($suma_progreso / $total_alumnos, 1) : 0; ?>%</span>
                    </div>
                    <div class="kpi-box" style="border-left-color: #00a32a;">
                        <h4>Alumnos que Ingresaron</h4>
                        <span class="kpi-value"><?php echo $total_ingresaron; ?></span>
                    </div>
                    <div class="kpi-box" style="border-left-color: #dc3232;">
                        <h4>Nunca han Ingresado</h4>
                        <span class="kpi-value"><?php echo $total_nunca; ?></span>
                    </div>
                    <div class="kpi-box" style="border-left-color: #2270b1;">
                        <h4>Con Progreso 100%</h4>
                        <span class="kpi-value"><?php echo $total_100; ?></span>
                    </div>
                    <div class="kpi-box" style="border-left-color: #dba617;">
                        <h4>Alumnos en Riesgo (>7d)</h4>
                        <span class="kpi-value"><?php echo $alumnos_criticos; ?></span>
                    </div>
                </div>

                <table class="wp-list-table widefat fixed striping" id="tabla-general">
                    <thead>
                        <tr>
                            <th class="sortable" data-sort-type="text" onclick="tmSortTable(this)">RUT <span
                                    class="sort-indicator">⇅</span></th>
                            <th class="sortable" data-sort-type="text" data-sort-dir="asc" onclick="tmSortTable(this)">Alumno <span
                                    class="sort-indicator">▲</span></th>
                            <th class="sortable" data-sort-type="text" onclick="tmSortTable(this)">Correo <span
                                    class="sort-indicator">⇅</span></th>
                            <th class="sortable" data-sort-type="number" onclick="tmSortTable(this)">% Progreso <span
                                    class="sort-indicator">⇅</span></th>
                            <th class="sortable" data-sort-type="number" onclick="tmSortTable(this)">Nota Final <span
                                    class="sort-indicator">⇅</span></th>
                            <th class="sortable" data-sort-type="number" onclick="tmSortTable(this)">Último Acceso <span
                                    class="sort-indicator">⇅</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php if (empty($alumnos)): ?>
                            <tr>
                                <td colspan="6">No hay alumnos matriculados en este curso.</td>
                            </tr>
                        <?php else: ?>
                            <?php foreach ($alumnos as $alumno):
                                // Formatear último acceso
                                $ultimo_unix = intval($alumno['ultimo_acceso_unix']);
                                if ($ultimo_unix === 0) {
                                    $acceso_humano = 'Nunca';
                                    $estilo_acceso = 'color: #dc3232; font-weight: bold;';
                                } else {
                                    $acceso_humano = date_i18n('d-m-Y H:i', $ultimo_unix);
                                    $dias_inactivo = (time() - $ultimo_unix) / DAY_IN_SECONDS;
                                    if ($dias_inactivo > 7) {
                                        $estilo_acceso = 'color: #dc3232; font-weight: bold;';
                                    } elseif ($dias_inactivo > 3) {
                                        $estilo_acceso = 'color: #ffb900; font-weight: bold;';
                                    } else {
                                        $estilo_acceso = 'color: #46b450; font-weight: bold;';
                                    }
                                }
                                ?>
                                <tr>
                                    <td data-sort-value="<?php echo esc_attr($alumno['rut']); ?>">
                                        <?php echo esc_html($alumno['rut'] ? $alumno['rut'] : 'N/A'); ?></td>
                                    <td data-sort-value="<?php echo esc_attr($alumno['nombre'] . ' ' . $alumno['apellido']); ?>">
                                        <?php echo esc_html($alumno['nombre'] . ' ' . $alumno['apellido']); ?></td>
                                    <td><?php echo esc_html($alumno['correo']); ?></td>
                                    <td data-sort-value="<?php echo esc_attr($alumno['progreso']); ?>">
                                        <strong><?php echo $alumno['progreso']; ?>%</strong>
                                        <div class="progreso-container">
                                            <div class="progreso-barra"
                                                style="width: <?php echo $alumno['progreso']; ?>%; <?php echo ($alumno['progreso'] >= 100) ? 'background: #46b450;' : ''; ?>">
                                            </div>
                                        </div>
                                    </td>
                                    <td data-sort-value="<?php echo esc_attr($alumno['nota_final'] ? $alumno['nota_final'] : '0'); ?>">
                                        <strong><?php echo $alumno['nota_final'] ? $alumno['nota_final'] : '0.0'; ?></strong></td>
                                    <td data-sort-value="<?php echo $ultimo_unix; ?>" style="<?php echo $estilo_acceso; ?>">
                                        <?php echo esc_html($acceso_humano); ?></td>
                                </tr>
                            <?php endforeach; ?>
                        <?php endif; ?>
                    </tbody>
                </table>

            <?php elseif ($vista_seleccionada === 'notas'): ?>
                <!-- Vista: Notas -->
                <div style="overflow-x: auto;">
                    <table class="wp-list-table widefat fixed striping" style="min-width: 1000px;" id="tabla-notas">
                        <thead>
                            <tr>
                                <th class="sortable" data-sort-type="text" style="width: 10%;" onclick="tmSortTable(this)">RUT <span
                                        class="sort-indicator">⇅</span></th>
                                <th class="sortable" data-sort-type="text" data-sort-dir="asc" style="width: 15%;"
                                    onclick="tmSortTable(this)">Alumno <span class="sort-indicator">▲</span></th>
                                <?php if (!empty($datos_reporte['actividades'])): ?>
                                    <?php foreach ($datos_reporte['actividades'] as $act_name): ?>
                                        <th class="sortable" data-sort-type="number" style="width: auto;" onclick="tmSortTable(this)">
                                            <?php echo esc_html($act_name); ?> <span class="sort-indicator">⇅</span></th>
                                    <?php endforeach; ?>
                                <?php else: ?>
                                    <th>Sin actividades calificables evaluadas</th>
                                <?php endif; ?>
                                <th class="sortable" data-sort-type="number"
                                    style="width: auto; background: #f0f0f1; font-weight: bold;" onclick="tmSortTable(this)">Total
                                    del Curso <span class="sort-indicator">⇅</span></th>
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
                                        <td data-sort-value="<?php echo esc_attr($alumno['rut']); ?>">
                                            <?php echo esc_html($alumno['rut'] ? $alumno['rut'] : 'N/A'); ?></td>
                                        <td data-sort-value="<?php echo esc_attr($alumno['nombre'] . ' ' . $alumno['apellido']); ?>">
                                            <?php echo esc_html($alumno['nombre'] . ' ' . $alumno['apellido']); ?></td>
                                        <?php if (!empty($datos_reporte['actividades'])): ?>
                                            <?php foreach ($datos_reporte['actividades'] as $act_id => $act_name): ?>
                                                <?php $nota_val = isset($alumno['notas_parciales'][$act_id]) ? $alumno['notas_parciales'][$act_id] : '-'; ?>
                                                <td data-sort-value="<?php echo is_numeric($nota_val) ? esc_attr($nota_val) : '-1'; ?>">
                                                    <?php echo esc_html($nota_val); ?>
                                                </td>
                                            <?php endforeach; ?>
                                        <?php else: ?>
                                            <td>-</td>
                                        <?php endif; ?>
                                        <td data-sort-value="<?php echo is_numeric($alumno['nota_total_curso']) ? esc_attr($alumno['nota_total_curso']) : '-1'; ?>"
                                            style="font-weight: bold; background: #f9f9f9;">
                                            <?php echo esc_html($alumno['nota_total_curso']); ?>
                                        </td>
                                    </tr>
                                <?php endforeach; ?>
                            <?php endif; ?>
                        </tbody>
                    </table>
                </div>

            <?php elseif ($vista_seleccionada === 'accesos'): ?>
                <!-- Vista: Accesos -->
                <table class="wp-list-table widefat fixed striping" id="tabla-accesos">
                    <thead>
                        <tr>
                            <th class="sortable" data-sort-type="text" onclick="tmSortTable(this)">RUT <span
                                    class="sort-indicator">⇅</span></th>
                            <th class="sortable" data-sort-type="text" onclick="tmSortTable(this)">Alumno <span
                                    class="sort-indicator">⇅</span></th>
                            <th class="sortable" data-sort-type="text" onclick="tmSortTable(this)">Correo <span
                                    class="sort-indicator">⇅</span></th>
                            <th class="sortable" data-sort-type="number" data-sort-dir="asc" onclick="tmSortTable(this)">Último
                                Acceso <span class="sort-indicator">▲</span></th>
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
                                    <td data-sort-value="<?php echo esc_attr($alumno['rut']); ?>">
                                        <?php echo esc_html($alumno['rut'] ? $alumno['rut'] : 'N/A'); ?></td>
                                    <td data-sort-value="<?php echo esc_attr($alumno['nombre'] . ' ' . $alumno['apellido']); ?>">
                                        <?php echo esc_html($alumno['nombre'] . ' ' . $alumno['apellido']); ?></td>
                                    <td><?php echo esc_html($alumno['correo']); ?></td>
                                    <td data-sort-value="<?php echo intval($alumno['ultimo_acceso_unix']); ?>">
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

    <script>
        // === BUSCADOR DE CURSOS ===
        function tmFiltrarCursos() {
            var input = document.getElementById('tm_curso_buscar');
            var filter = input.value.toUpperCase();
            var select = document.getElementById('tm_curso_id');
            var options = select.getElementsByTagName('option');

            for (var i = 0; i < options.length; i++) {
                if (options[i].value === '') continue; // Mantener el placeholder
                var txt = options[i].textContent || options[i].innerText;
                if (txt.toUpperCase().indexOf(filter) > -1) {
                    options[i].style.display = '';
                } else {
                    options[i].style.display = 'none';
                }
            }
        }

        // === SORTABLE TABLES ===
        function tmSortTable(thElement) {
            var table = thElement.closest('table');
            if (!table) return;

            var tbody = table.querySelector('tbody');
            if (!tbody) return;

            var rows = Array.from(tbody.querySelectorAll('tr'));

            // Saltar si hay mensaje vacío (colspan)
            if (rows.length === 0) return;
            if (rows[0].cells.length === 1 && rows[0].cells[0].colSpan > 1) return;

            var thIndex = Array.from(thElement.parentNode.children).indexOf(thElement);
            var sortType = thElement.dataset.sortType || 'text';
            var currentDir = thElement.dataset.sortDir || '';
            var newDir = currentDir === 'asc' ? 'desc' : 'asc';

            // Reset visual indicators
            thElement.parentNode.querySelectorAll('th.sortable').forEach(function (th) {
                th.dataset.sortDir = '';
                var ind = th.querySelector('.sort-indicator');
                if (ind) ind.textContent = '⇅';
            });

            // Set new direction
            thElement.dataset.sortDir = newDir;
            var indicator = thElement.querySelector('.sort-indicator');
            if (indicator) indicator.textContent = newDir === 'asc' ? '▲' : '▼';

            rows.sort(function (a, b) {
                var aCell = a.cells[thIndex];
                var bCell = b.cells[thIndex];

                var aVal = aCell.dataset.sortValue !== undefined ? aCell.dataset.sortValue : aCell.textContent.trim();
                var bVal = bCell.dataset.sortValue !== undefined ? bCell.dataset.sortValue : bCell.textContent.trim();

                if (sortType === 'number') {
                    aVal = parseFloat(aVal) || 0;
                    bVal = parseFloat(bVal) || 0;
                    return newDir === 'asc' ? aVal - bVal : bVal - aVal;
                }

                // Text comparison
                return newDir === 'asc'
                    ? aVal.localeCompare(bVal, 'es', { numeric: true, sensitivity: 'base' })
                    : bVal.localeCompare(aVal, 'es', { numeric: true, sensitivity: 'base' });
            });

            rows.forEach(function (row) { tbody.appendChild(row); });
        }
    </script>
    <?php
}
