<?php
/**
 * Plugin Name: TM Capacitación - Reportes Avanzados Moodle
 * Description: Panel de administración para consultar y descargar reportes detallados de alumnos desde la BD local de Moodle.
 * Version: 1.0.0
 * Author: Solvitu
 * License: GPL2
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit; // Prevenir acceso directo
}

// 1. Crear el menú en el Panel de Administración de WordPress
add_action( 'admin_menu', 'tm_reportes_moodle_menu' );
function tm_reportes_moodle_menu() {
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
function tm_reportes_obtener_cursos_moodle() {
    $cursos = [];
    
    // Validar que las constantes existan
    if ( ! defined('TM_MOODLE_DB_HOST') ) return $cursos;

    $mysqli = new mysqli(TM_MOODLE_DB_HOST, TM_MOODLE_DB_USER, TM_MOODLE_DB_PASS, TM_MOODLE_DB_NAME);
    if ( $mysqli->connect_error ) {
        error_log("Error de conexión Moodle en Reportes: " . $mysqli->connect_error);
        return $cursos;
    }

    $mysqli->set_charset("utf8mb4");
    $prefix = TM_MOODLE_DB_PREFIX;

    // Traemos los cursos excluyendo el sitio principal (ID 1)
    $sql = "SELECT id, fullname FROM {$prefix}course WHERE id > 1 AND visible = 1 ORDER BY fullname ASC";
    if ( $result = $mysqli->query($sql) ) {
        while ( $row = $result->fetch_assoc() ) {
            $cursos[] = $row;
        }
        $result->free();
    }
    $mysqli->close(); // Seguridad: Cierre estricto de conexión
    return $cursos;
}

// 3. Helper para ejecutar la Query Maestra de Datos Cruzados
function tm_reportes_obtener_datos_curso($curso_id) {
    $datos = [];
    if ( ! defined('TM_MOODLE_DB_HOST') || empty($curso_id) ) return $datos;

    $mysqli = new mysqli(TM_MOODLE_DB_HOST, TM_MOODLE_DB_USER, TM_MOODLE_DB_PASS, TM_MOODLE_DB_NAME);
    if ( $mysqli->connect_error ) return $datos;

    $mysqli->set_charset("utf8mb4");
    $prefix = TM_MOODLE_DB_PREFIX;

    // Query Blindada utilizando marcadores de posición (?) contra Inyección SQL
    $sql = "SELECT 
                u.idnumber AS rut,
                u.firstname AS nombre,
                u.lastname AS apellido,
                u.email AS correo,
                u.lastaccess AS ultimo_acceso_unix,
                ROUND(gg.finalgrade, 1) AS nota_final,
                -- Subquery: Progreso de actividades completadas
                (SELECT COUNT(cmc.id) 
                 FROM {$prefix}course_modules cm
                 JOIN {$prefix}course_modules_completion cmc ON cmc.coursemoduleid = cm.id
                 WHERE cm.course = c.id AND cmc.userid = u.id AND cmc.completionstate = 1) AS actividades_completadas,
                -- Subquery: Total actividades con rastreo de finalización en el curso
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

    if ( $stmt = $mysqli->prepare($sql) ) {
        $stmt->bind_param("i", $curso_id);
        $stmt->execute();
        $result = $stmt->get_result();
        
        while ( $row = $result->fetch_assoc() ) {
            // Calcular porcentaje de progreso en tiempo de ejecución
            $total = intval($row['total_actividades']);
            $comp = intval($row['actividades_completadas']);
            $row['progreso'] = ($total > 0) ? round(($comp / $total) * 100, 1) : 0;
            
            $datos[] = $row;
        }
        $stmt->close();
    }
    $mysqli->close(); // Seguridad: Cierre estricto de conexión
    return $datos;
}

// 4. Renderizado de la Interfaz en WordPress
function tm_reportes_moodle_render_page() {
    $cursos = tm_reportes_obtener_cursos_moodle();
    $curso_seleccionado = isset($_POST['tm_curso_id']) ? intval($_POST['tm_curso_id']) : 0;
    $alumnos = [];

    if ( $curso_seleccionado > 0 ) {
        $alumnos = tm_reportes_obtener_datos_curso($curso_seleccionado);
    }
    ?>
    <div class="wrap">
        <h1>📊 Sistema de Reportes Avanzados (Moodle Local)</h1>
        <p>Consulta el avance milimétrico de los alumnos consumiendo los datos directamente del VPS.</p>
        <hr />

        <form method="post" style="margin-bottom: 20px; background: #fff; padding: 15px; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <label for="tm_curso_id" style="font-weight: bold; margin-right: 10px;">Selecciona el Curso / Institución:</label>
            <select name="tm_curso_id" id="tm_curso_id" style="min-width: 300px; padding: 5px;">
                <option value="">-- Seleccione un Curso --</option>
                <?php foreach ( $cursos as $curso ) : ?>
                    <option value="<?php echo $curso['id']; ?>" <?php selected($curso_seleccionado, $curso['id']); ?>>
                        <?php echo esc_html($curso['fullname']); ?>
                    </option>
                <?php endforeach; ?>
            </select>
            <?php submit_button('Filtrar Alumnos', 'primary', 'submit', false, ['style' => 'margin-left: 10px; vertical-align: top;']); ?>
        </form>

        <?php if ( $curso_seleccionado > 0 ) : ?>
            <h3>Resultados del Reporte (<?php echo count($alumnos); ?> alumnos encontrados)</h3>
            
            <table class="wp-list-table widefat fixed striping posts">
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
                    <?php if ( empty($alumnos) ) : ?>
                        <tr><td colspan="6">No hay alumnos matriculados en este curso.</td></tr>
                    <?php else : ?>
                        <?php foreach ( $alumnos as $alumno ) : 
                            // Lógica del Semáforo de Deserción
                            $alerta = '🟢 Activo';
                            $estilo_alerta = 'color: #46b450; font-weight: bold;';
                            
                            if ( $alumno['ultimo_acceso_unix'] == 0 ) {
                                $alerta = '🔴 Nunca ha ingresado';
                                $estilo_alerta = 'color: #dc3232; font-weight: bold;';
                            } else {
                                $dias_inactivo = ( time() - $alumno['ultimo_acceso_unix'] ) / DAY_IN_SECONDS;
                                if ( $dias_inactivo > 7 ) {
                                    $alerta = '🔴 En Riesgo (>7d inactivo)';
                                    $estilo_alerta = 'color: #dc3232; font-weight: bold;';
                                } elseif ( $dias_inactivo > 3 ) {
                                    $alerta = '🟡 Ausente (>3d)';
                                    $estilo_alerta = 'color: #ffb900; font-weight: bold;';
                                }
                            }
                            ?>
                            <tr>
                                <td><?php echo esc_html($alumno['rut'] ? $alumno['rut'] : 'No registrado'); ?></td>
                                <td><?php echo esc_html($alumno['nombre'] . ' ' . $alumno['apellido']); ?></td>
                                <td><?php echo esc_html($alumno['correo']); ?></td>
                                <td>
                                    <strong><?php echo $alumno['progreso']; ?>%</strong>
                                    <div style="background: #ddd; width: 100px; height: 8px; border-radius: 4px; margin-top: 4px;">
                                        <div style="background: #0073aa; width: <?php echo $alumno['progreso']; ?>px; height: 8px; border-radius: 4px;"></div>
                                    </div>
                                </td>
                                <td><strong><?php echo $alumno['nota_final'] ? $alumno['nota_final'] : '0.0'; ?></strong></td>
                                <td style="<?php echo $estilo_alerta; ?>"><?php echo $alerta; ?></td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </tbody>
            </table>
        <?php endif; ?>
    </div>
    <?php
}