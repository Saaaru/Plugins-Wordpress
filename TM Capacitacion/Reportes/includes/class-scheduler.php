<?php
/**
 * Clase TM_Reportes_Scheduler
 * 
 * Gestiona la programación de envíos automáticos mediante WP-Cron.
 * Calcula próximas fechas de envío y ejecuta el procesamiento de configs pendientes.
 */

if (!defined('ABSPATH')) {
    exit;
}

class TM_Reportes_Scheduler
{
    /**
     * Hook del cron
     */
    const CRON_HOOK = 'tm_reportes_cron_hook';

    /**
     * Intervalo del cron en segundos (15 minutos)
     */
    const CRON_INTERVAL = 900;

    /**
     * Inicializar el scheduler
     */
    public function init()
    {
        // Agregar intervalo personalizado
        add_filter('cron_schedules', [$this, 'agregar_intervalo_cron']);

        // Hook del cron
        add_action(self::CRON_HOOK, [$this, 'procesar_envios_pendientes']);
    }

    /**
     * Agregar intervalo de 15 minutos a los schedules de WP-Cron
     */
    public function agregar_intervalo_cron($schedules)
    {
        $schedules['tm_every_15_minutes'] = [
            'interval' => self::CRON_INTERVAL,
            'display'  => 'Cada 15 minutos (TM Reportes)'
        ];
        return $schedules;
    }

    /**
     * Activar el evento recurrente de WP-Cron
     */
    public function activar_cron()
    {
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time() + 60, 'tm_every_15_minutes', self::CRON_HOOK);
        }
    }

    /**
     * Desactivar el evento recurrente al desinstalar
     */
    public function desactivar_cron()
    {
        $timestamp = wp_next_scheduled(self::CRON_HOOK);
        if ($timestamp) {
            wp_unschedule_event($timestamp, self::CRON_HOOK);
        }
        wp_clear_scheduled_hook(self::CRON_HOOK);
    }

    /**
     * Procesar todos los envíos pendientes
     * Este método es llamado por WP-Cron cada 15 minutos
     */
    public function procesar_envios_pendientes()
    {
        $db = TM_Reportes_DB::get_instance();
        $mailer = new TM_Reportes_Mailer();

        $configs = $db->obtener_configs_para_envio();

        if (empty($configs)) {
            return;
        }

        $fecha_hoy = current_time('Y-m-d');

        foreach ($configs as $config) {
            // Validar rango de fechas
            if (!empty($config['fecha_inicio']) && $fecha_hoy < $config['fecha_inicio']) {
                continue; // Aún no está en el rango de inicio
            }
            if (!empty($config['fecha_fin']) && $fecha_hoy > $config['fecha_fin']) {
                // Pasó la fecha fin: pausar automáticamente
                $db->actualizar_config($config['id'], ['activo' => 0]);
                continue;
            }

            // Generar y enviar el reporte
            $resultado = $mailer->enviar_reporte($config);

            // Calcular próximo envío
            $proximo = $this->calcular_proximo_envio($config);

            // Actualizar config
            $db->actualizar_config($config['id'], [
                'ultimo_envio'  => current_time('mysql'),
                'proximo_envio' => $proximo,
            ]);
        }
    }

    /**
     * Calcular la próxima fecha de envío basada en frecuencia, día y hora
     * 
     * @param array $config Configuración del envío
     * @return string|null Fecha en formato MySQL o null si está fuera de rango
     */
    public function calcular_proximo_envio($config)
    {
        $frecuencia = $config['frecuencia'];
        $dia_envio = $config['dia_envio'];
        $hora_envio = $config['hora_envio'];

        $ahora_timestamp = current_time('timestamp');
        $proximo_timestamp = null;

        switch ($frecuencia) {
            case 'diario':
                // Mañana a la hora configurada
                $proximo_timestamp = strtotime('tomorrow ' . $hora_envio, $ahora_timestamp);
                // Si ya pasó hoy, mañana a la hora
                $hoy_a_la_hora = strtotime('today ' . $hora_envio, $ahora_timestamp);
                if ($hoy_a_la_hora > $ahora_timestamp) {
                    $proximo_timestamp = $hoy_a_la_hora;
                }
                break;

            case 'semanal':
                // Próximo día de la semana seleccionado a la hora configurada
                $dias_semana = [
                    'monday'    => 'Monday',
                    'tuesday'   => 'Tuesday',
                    'wednesday' => 'Wednesday',
                    'thursday'  => 'Thursday',
                    'friday'    => 'Friday',
                    'saturday'  => 'Saturday',
                    'sunday'    => 'Sunday',
                ];
                $nombre_dia = $dias_semana[$dia_envio] ?? 'Monday';
                $proximo_timestamp = strtotime('next ' . $nombre_dia . ' ' . $hora_envio, $ahora_timestamp);

                // Si es hoy y aún no pasó la hora, usar hoy
                $hoy_a_la_hora = strtotime('today ' . $hora_envio, $ahora_timestamp);
                $dia_actual = strtolower(date('l', $ahora_timestamp));
                if ($dia_actual === $dia_envio && $hoy_a_la_hora > $ahora_timestamp) {
                    $proximo_timestamp = $hoy_a_la_hora;
                }
                break;

            case 'mensual':
                // Día del mes seleccionado a la hora configurada
                $dia_num = intval($dia_envio);
                $mes_actual = date('n', $ahora_timestamp);
                $anio_actual = date('Y', $ahora_timestamp);
                $dia_max_mes = date('t', $ahora_timestamp);

                // Ajustar si el día excede los días del mes
                $dia_ajustado = min($dia_num, intval($dia_max_mes));

                $fecha_base = sprintf('%04d-%02d-%02d %s', $anio_actual, $mes_actual, $dia_ajustado, $hora_envio);
                $proximo_timestamp = strtotime($fecha_base, $ahora_timestamp);

                // Si ya pasó este mes, ir al próximo mes
                if ($proximo_timestamp <= $ahora_timestamp) {
                    $proximo_timestamp = strtotime('+1 month', $proximo_timestamp);
                    // Reajustar el día si el próximo mes tiene menos días
                    $dia_max_prox = date('t', $proximo_timestamp);
                    if ($dia_num > intval($dia_max_prox)) {
                        $proximo_timestamp = strtotime(
                            sprintf('%s-%02d %s', date('Y-m', $proximo_timestamp), $dia_max_prox, $hora_envio)
                        );
                    }
                }
                break;
        }

        if ($proximo_timestamp === null) {
            return null;
        }

        // Validar dentro de rango de fechas límite
        if (!empty($config['fecha_fin'])) {
            $fin_timestamp = strtotime($config['fecha_fin'] . ' 23:59:59');
            if ($proximo_timestamp > $fin_timestamp) {
                return null; // Fuera de rango
            }
        }

        // Si hay fecha de inicio y el próximo envío es antes, ajustar
        if (!empty($config['fecha_inicio'])) {
            $inicio_timestamp = strtotime($config['fecha_inicio'] . ' 00:00:00');
            if ($proximo_timestamp < $inicio_timestamp) {
                $proximo_timestamp = strtotime($config['fecha_inicio'] . ' ' . $hora_envio);
            }
        }

        return date('Y-m-d H:i:s', $proximo_timestamp);
    }

    /**
     * Forzar el envío inmediato de una configuración (acción "Enviar ahora")
     * No requiere esperar al cron
     * 
     * @param int $config_id ID de la configuración
     * @return array Resultado con éxito/mensaje
     */
    public function enviar_ahora($config_id)
    {
        $db = TM_Reportes_DB::get_instance();
        $config = $db->obtener_config($config_id);

        if (!$config) {
            return ['exito' => false, 'mensaje' => 'Configuración no encontrada.'];
        }

        $mailer = new TM_Reportes_Mailer();
        $resultado = $mailer->enviar_reporte($config);

        // Recalcular próximo envío
        $proximo = $this->calcular_proximo_envio($config);

        $db->actualizar_config($config_id, [
            'ultimo_envio'  => current_time('mysql'),
            'proximo_envio' => $proximo,
        ]);

        return $resultado;
    }

    /**
     * Recalcular próximos envíos para todas las configs activas
     * Útil después de editar frecuencias
     */
    public function recalcular_todos_proximos()
    {
        $db = TM_Reportes_DB::get_instance();
        $configs = $db->obtener_todas_configs();

        foreach ($configs as $config) {
            if ($config['activo']) {
                $proximo = $this->calcular_proximo_envio($config);
                $db->actualizar_config($config['id'], ['proximo_envio' => $proximo]);
            }
        }
    }
}
