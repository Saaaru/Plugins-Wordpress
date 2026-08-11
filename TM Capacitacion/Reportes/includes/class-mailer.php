<?php
/**
 * Clase TM_Reportes_Mailer
 * 
 * Genera el contenido de los reportes y los envía por email.
 * Para "general" genera HTML embebido; para "notas" y "accesos" genera CSV adjunto.
 */

if (!defined('ABSPATH')) {
    exit;
}

class TM_Reportes_Mailer
{
    /**
     * Enviar un reporte según la configuración
     * 
     * @param array $config Configuración de envío
     * @return array Resultado ['exito' => bool, 'mensaje' => string]
     */
    public function enviar_reporte($config)
    {
        $curso_id = intval($config['curso_id']);
        $tipo_reporte = $config['tipo_reporte'];
        $curso_nombre = $config['curso_nombre'];

        // Validar que las constantes de conexión a Moodle existan
        if (!defined('TM_MOODLE_DB_HOST')) {
            $this->registrar_historial($config, 'fallido', 'No hay conexión configurada a la BD de Moodle');
            return ['exito' => false, 'mensaje' => 'No hay conexión a Moodle configurada.'];
        }

        // Obtener datos del reporte
        $datos = tm_reportes_obtener_datos_curso($curso_id, $tipo_reporte);

        if (empty($datos) || (is_array($datos) && isset($datos['alumnos']) && empty($datos['alumnos']))) {
            $this->registrar_historial($config, 'fallido', 'No hay datos en el curso');
            return ['exito' => false, 'mensaje' => 'No hay datos para generar el reporte del curso.'];
        }

        // Construir email según tipo
        if ($tipo_reporte === 'general') {
            return $this->enviar_reporte_general($config, $datos);
        } else {
            return $this->enviar_reporte_csv($config, $datos, $tipo_reporte);
        }
    }

    /**
     * Enviar reporte general como HTML embebido
     */
    private function enviar_reporte_general($config, $datos)
    {
        $curso_nombre = $config['curso_nombre'];
        $total_alumnos = count($datos);

        // Calcular KPIs
        $suma_notas = 0;
        $suma_progreso = 0;
        $alumnos_criticos = 0;
        $total_nunca = 0;
        $total_100 = 0;

        foreach ($datos as $al) {
            $suma_notas += floatval($al['nota_final']);
            $suma_progreso += floatval($al['progreso']);
            $progreso = floatval($al['progreso']);
            $ultimo = intval($al['ultimo_acceso_unix']);

            if ($ultimo == 0) {
                $total_nunca++;
            }

            if ($progreso >= 100) {
                $total_100++;
            }

            // Alumnos en riesgo (mismo cálculo que en el panel)
            $en_riesgo = false;
            if ($ultimo == 0) {
                $en_riesgo = true;
            } elseif ($progreso < 100 && (time() - $ultimo) / DAY_IN_SECONDS > 7) {
                $en_riesgo = true;
            }
            if ($progreso < 50) {
                $en_riesgo = true;
            }
            if ($en_riesgo) {
                $alumnos_criticos++;
            }
        }

        $promedio = $total_alumnos > 0 ? round($suma_notas / $total_alumnos, 1) : 0;
        $avance = $total_alumnos > 0 ? round($suma_progreso / $total_alumnos, 1) : 0;

        // Construir HTML del email
        $html = $this->generar_html_general($curso_nombre, $datos, $promedio, $avance, $alumnos_criticos, $total_nunca, $total_100, $total_alumnos);

        // Asunto
        $asunto = sprintf('Reporte de Avance - %s - %s', $curso_nombre, date_i18n('d-m-Y'));

        // Headers
        $headers = [
            'Content-Type: text/html; charset=UTF-8',
        ];

        // Copia interna
        $cc_emails = $this->parsear_cc($config['copia_interna']);
        if (!empty($cc_emails)) {
            $headers[] = 'Cc: ' . implode(', ', $cc_emails);
        }

        // Enviar
        $enviado = wp_mail($config['correo_coordinador'], $asunto, $html, $headers);

        if ($enviado) {
            $this->registrar_historial($config, 'enviado', null);
            return ['exito' => true, 'mensaje' => 'Reporte enviado correctamente a ' . $config['correo_coordinador']];
        } else {
            $error = 'Error al enviar el email (verificar configuración SMTP)';
            $this->registrar_historial($config, 'fallido', $error);
            return ['exito' => false, 'mensaje' => $error];
        }
    }

    /**
     * Enviar reporte de notas o accesos como CSV adjunto
     */
    private function enviar_reporte_csv($config, $datos, $tipo_reporte)
    {
        $curso_nombre = $config['curso_nombre'];

        // Generar CSV temporal
        $csv_contenido = $this->generar_csv($datos, $tipo_reporte);
        $archivo_temp = tempnam(sys_get_temp_dir(), 'tm_reporte_') . '.csv';

        // Escribir con BOM UTF-8
        $fp = fopen($archivo_temp, 'w');
        fputs($fp, "\xEF\xBB\xBF");
        fwrite($fp, $csv_contenido);
        fclose($fp);

        // Asunto
        $tipo_texto = $tipo_reporte === 'notas' ? 'Calificaciones Parciales' : 'Últimos Accesos';
        $asunto = sprintf('Reporte de %s - %s - %s', $tipo_texto, $curso_nombre, date_i18n('d-m-Y'));

        // Mensaje HTML simple
        $mensaje = sprintf(
            '<html><body>
            <h2>Reporte de %s</h2>
            <p><strong>Curso:</strong> %s</p>
            <p><strong>Coordinador:</strong> %s</p>
            <p><strong>Fecha de generación:</strong> %s</p>
            <p>Se adjunta el archivo CSV con el reporte solicitado.</p>
            </body></html>',
            $tipo_texto,
            esc_html($curso_nombre),
            esc_html($config['nombre_coordinador']),
            date_i18n('d-m-Y H:i')
        );

        // Headers
        $headers = [
            'Content-Type: text/html; charset=UTF-8',
        ];

        $cc_emails = $this->parsear_cc($config['copia_interna']);
        if (!empty($cc_emails)) {
            $headers[] = 'Cc: ' . implode(', ', $cc_emails);
        }

        // Enviar con adjunto
        $enviado = wp_mail($config['correo_coordinador'], $asunto, $mensaje, $headers, [$archivo_temp]);

        // Limpiar archivo temporal
        @unlink($archivo_temp);

        if ($enviado) {
            $this->registrar_historial($config, 'enviado', null);
            return ['exito' => true, 'mensaje' => 'Reporte enviado correctamente a ' . $config['correo_coordinador']];
        } else {
            $error = 'Error al enviar el email con adjunto';
            $this->registrar_historial($config, 'fallido', $error);
            return ['exito' => false, 'mensaje' => $error];
        }
    }

    /**
     * Generar HTML para reporte general
     */
    private function generar_html_general($curso_nombre, $datos, $promedio, $avance, $criticos, $nunca, $completos, $total)
    {
        // KPIs
        $kpi_html = sprintf(
            '<table style="width:100%%;border-collapse:collapse;margin:20px 0;">
                <tr>
                    <td style="padding:15px;text-align:center;border:1px solid #e0e0e0;background:#f9f9f9;">
                        <div style="font-size:11px;color:#666;margin-bottom:5px;">PROMEDIO GENERAL</div>
                        <div style="font-size:28px;font-weight:bold;color:#0073aa;">%s</div>
                    </td>
                    <td style="padding:15px;text-align:center;border:1px solid #e0e0e0;background:#f9f9f9;">
                        <div style="font-size:11px;color:#666;margin-bottom:5px;">AVANCE DEL GRUPO</div>
                        <div style="font-size:28px;font-weight:bold;color:#46b450;">%s%%</div>
                    </td>
                    <td style="padding:15px;text-align:center;border:1px solid #e0e0e0;background:#f9f9f9;">
                        <div style="font-size:11px;color:#666;margin-bottom:5px;">ALUMNOS EN RIESGO</div>
                        <div style="font-size:28px;font-weight:bold;color:#dc3232;">%d</div>
                    </td>
                    <td style="padding:15px;text-align:center;border:1px solid #e0e0e0;background:#f9f9f9;">
                        <div style="font-size:11px;color:#666;margin-bottom:5px;">NUNCA HAN INGRESADO</div>
                        <div style="font-size:28px;font-weight:bold;color:#dc3232;">%d</div>
                    </td>
                    <td style="padding:15px;text-align:center;border:1px solid #e0e0e0;background:#f9f9f9;">
                        <div style="font-size:11px;color:#666;margin-bottom:5px;">PROGRESO 100%%</div>
                        <div style="font-size:28px;font-weight:bold;color:#2270b1;">%d</div>
                    </td>
                </tr>
            </table>',
            esc_html($promedio),
            esc_html($avance),
            intval($criticos),
            intval($nunca),
            intval($completos)
        );

        // Filas de la tabla
        $filas = '';
        foreach ($datos as $alumno) {
            $ultimo_unix = intval($alumno['ultimo_acceso_unix']);
            $acceso = $ultimo_unix === 0 ? 'Nunca' : date_i18n('d-m-Y', $ultimo_unix);
            $color_acceso = $ultimo_unix === 0 ? '#dc3232' : '#333';

            $filas .= sprintf(
                '<tr>
                    <td style="padding:8px;border:1px solid #e0e0e0;">%s</td>
                    <td style="padding:8px;border:1px solid #e0e0e0;">%s</td>
                    <td style="padding:8px;border:1px solid #e0e0e0;text-align:center;">%s%%</td>
                    <td style="padding:8px;border:1px solid #e0e0e0;text-align:center;">%s</td>
                    <td style="padding:8px;border:1px solid #e0e0e0;text-align:center;color:%s;">%s</td>
                </tr>',
                esc_html($alumno['rut'] ? $alumno['rut'] : 'N/A'),
                esc_html($alumno['nombre'] . ' ' . $alumno['apellido']),
                esc_html($alumno['progreso']),
                esc_html($alumno['nota_final'] ? $alumno['nota_final'] : '0.0'),
                $color_acceso,
                esc_html($acceso)
            );
        }

        $html = sprintf(
            '<html>
            <head>
                <meta charset="UTF-8">
            </head>
            <body style="font-family:Arial,Helvetica,sans-serif;color:#333;max-width:800px;margin:0 auto;">
                <div style="background:#0073aa;color:#fff;padding:20px;text-align:center;">
                    <h1 style="margin:0;font-size:22px;">📊 Reporte de Avance General</h1>
                </div>
                <div style="padding:20px;">
                    <h2 style="color:#0073aa;">%s</h2>
                    <p style="color:#666;font-size:14px;">
                        <strong>Total de alumnos:</strong> %d &nbsp;|&nbsp;
                        <strong>Fecha de generación:</strong> %s
                    </p>
                    %s
                    <table style="width:100%%;border-collapse:collapse;margin-top:20px;font-size:13px;">
                        <thead>
                            <tr style="background:#0073aa;color:#fff;">
                                <th style="padding:10px;border:1px solid #006291;text-align:left;">RUT</th>
                                <th style="padding:10px;border:1px solid #006291;text-align:left;">Alumno</th>
                                <th style="padding:10px;border:1px solid #006291;">Progreso</th>
                                <th style="padding:10px;border:1px solid #006291;">Nota Final</th>
                                <th style="padding:10px;border:1px solid #006291;">Último Acceso</th>
                            </tr>
                        </thead>
                        <tbody>
                            %s
                        </tbody>
                    </table>
                    <p style="margin-top:20px;font-size:12px;color:#999;text-align:center;">
                        Reporte generado automáticamente por TM Capacitación - Reportes Moodle
                    </p>
                </div>
            </body>
            </html>',
            esc_html($curso_nombre),
            intval($total),
            date_i18n('d-m-Y H:i'),
            $kpi_html,
            $filas
        );

        return $html;
    }

    /**
     * Generar contenido CSV para notas o accesos
     */
    private function generar_csv($datos, $tipo_reporte)
    {
        $output = '';

        if ($tipo_reporte === 'accesos') {
            $output .= "RUT;Nombre;Apellido;Correo;Ultimo Acceso\n";
            foreach ($datos as $alumno) {
                $ultimo = intval($alumno['ultimo_acceso_unix']);
                $acceso = $ultimo === 0 ? 'Nunca' : date_i18n('d-m-Y H:i', $ultimo);
                $output .= sprintf(
                    "%s;%s;%s;%s;%s\n",
                    $alumno['rut'],
                    $alumno['nombre'],
                    $alumno['apellido'],
                    $alumno['correo'],
                    $acceso
                );
            }
        } elseif ($tipo_reporte === 'notas') {
            $alumnos = isset($datos['alumnos']) ? $datos['alumnos'] : [];
            $actividades = isset($datos['actividades']) ? $datos['actividades'] : [];

            // Cabeceras
            $headers = ['RUT', 'Nombre', 'Apellido', 'Correo'];
            foreach ($actividades as $act_name) {
                $headers[] = $act_name;
            }
            $headers[] = 'Total del Curso';
            $output .= implode(';', $headers) . "\n";

            // Filas
            foreach ($alumnos as $alumno) {
                $fila = [
                    $alumno['rut'],
                    $alumno['nombre'],
                    $alumno['apellido'],
                    $alumno['correo'],
                ];
                if (!empty($actividades)) {
                    foreach ($actividades as $act_id => $act_name) {
                        $nota = isset($alumno['notas_parciales'][$act_id]) ? $alumno['notas_parciales'][$act_id] : '-';
                        $fila[] = $nota;
                    }
                }
                $fila[] = isset($alumno['nota_total_curso']) ? $alumno['nota_total_curso'] : '-';
                $output .= implode(';', $fila) . "\n";
            }
        }

        return $output;
    }

    /**
     * Parsear direcciones CC separadas por coma o salto de línea
     */
    private function parsear_cc($cc_texto)
    {
        if (empty($cc_texto)) {
            return [];
        }
        $emails = preg_split('/[\n,]+/', $cc_texto);
        $validos = [];
        foreach ($emails as $email) {
            $email = trim($email);
            if (is_email($email)) {
                $validos[] = $email;
            }
        }
        return $validos;
    }

    /**
     * Registrar un envío en el historial
     */
    private function registrar_historial($config, $estado, $error = null)
    {
        $db = TM_Reportes_DB::get_instance();

        $cc_emails = $this->parsear_cc($config['copia_interna']);
        $destinos = $config['correo_coordinador'];
        if (!empty($cc_emails)) {
            $destinos .= ' (CC: ' . implode(', ', $cc_emails) . ')';
        }

        $db->insertar_historial([
            'config_id'      => $config['id'],
            'curso_id'       => $config['curso_id'],
            'curso_nombre'   => $config['curso_nombre'],
            'coordinador'    => $config['nombre_coordinador'],
            'correo_destino' => $destinos,
            'tipo_reporte'   => $config['tipo_reporte'],
            'estado'         => $estado,
            'mensaje_error'  => $error,
        ]);
    }
}
