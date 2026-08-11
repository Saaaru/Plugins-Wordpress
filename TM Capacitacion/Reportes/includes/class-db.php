<?php
/**
 * Clase TM_Reportes_DB
 * 
 * Gestión de tablas custom y operaciones CRUD para la automatización de reportes.
 * Crea dos tablas en la BD de WordPress:
 * - {prefix}tm_reportes_config: configuraciones de coordinadores por curso
 * - {prefix}tm_reportes_historial: historial de envíos de reportes
 */

if (!defined('ABSPATH')) {
    exit;
}

class TM_Reportes_DB
{
    /**
     * Instancia única (singleton)
     */
    private static $instance = null;

    /**
     * Tabla de configuraciones
     */
    public $table_config;

    /**
     * Tabla de historial
     */
    public $table_historial;

    /**
     * Obtener instancia singleton
     */
    public static function get_instance()
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Constructor — define nombres de tablas
     */
    private function __construct()
    {
        global $wpdb;
        $this->table_config = $wpdb->prefix . 'tm_reportes_config';
        $this->table_historial = $wpdb->prefix . 'tm_reportes_historial';
    }

    /**
     * Crear tablas al activar el plugin (o al actualizar)
     */
    public function crear_tablas()
    {
        global $wpdb;
        $charset_collate = $wpdb->get_charset_collate();

        // Tabla de configuraciones
        $sql_config = "CREATE TABLE {$this->table_config} (
            id INT AUTO_INCREMENT PRIMARY KEY,
            institucion VARCHAR(255) NOT NULL DEFAULT '',
            nombre_coordinador VARCHAR(255) NOT NULL DEFAULT '',
            correo_coordinador VARCHAR(255) NOT NULL DEFAULT '',
            curso_id INT NOT NULL DEFAULT 0,
            curso_nombre VARCHAR(500) NOT NULL DEFAULT '',
            frecuencia ENUM('diario','semanal','mensual') NOT NULL DEFAULT 'semanal',
            dia_envio VARCHAR(20) NOT NULL DEFAULT 'monday',
            hora_envio TIME NOT NULL DEFAULT '08:00',
            tipo_reporte ENUM('general','notas','accesos') NOT NULL DEFAULT 'general',
            copia_interna TEXT NULL,
            fecha_inicio DATE NULL,
            fecha_fin DATE NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            ultimo_envio DATETIME NULL,
            proximo_envio DATETIME NULL,
            creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) $charset_collate;";

        // Tabla de historial
        $sql_historial = "CREATE TABLE {$this->table_historial} (
            id INT AUTO_INCREMENT PRIMARY KEY,
            config_id INT NOT NULL DEFAULT 0,
            curso_id INT NOT NULL DEFAULT 0,
            curso_nombre VARCHAR(500) NOT NULL DEFAULT '',
            coordinador VARCHAR(255) NOT NULL DEFAULT '',
            correo_destino VARCHAR(500) NOT NULL DEFAULT '',
            tipo_reporte VARCHAR(20) NOT NULL DEFAULT 'general',
            estado ENUM('enviado','fallido') NOT NULL DEFAULT 'enviado',
            mensaje_error TEXT NULL,
            fecha_envio DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) $charset_collate;";

        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql_config);
        dbDelta($sql_historial);

        // Guardar versión para futuras migraciones
        update_option('tm_reportes_db_version', '1.0');
    }

    // =====================================================================
    // CRUD — Tabla de configuraciones
    // =====================================================================

    /**
     * Insertar nueva configuración
     * 
     * @param array $datos Datos de la configuración
     * @return int|false ID insertado o false en error
     */
    public function insertar_config($datos)
    {
        global $wpdb;

        $resultado = $wpdb->insert(
            $this->table_config,
            [
                'institucion'        => sanitize_text_field($datos['institucion']),
                'nombre_coordinador' => sanitize_text_field($datos['nombre_coordinador']),
                'correo_coordinador' => sanitize_email($datos['correo_coordinador']),
                'curso_id'           => intval($datos['curso_id']),
                'curso_nombre'       => sanitize_text_field($datos['curso_nombre']),
                'frecuencia'         => sanitize_text_field($datos['frecuencia']),
                'dia_envio'          => sanitize_text_field($datos['dia_envio']),
                'hora_envio'         => sanitize_text_field($datos['hora_envio']),
                'tipo_reporte'       => sanitize_text_field($datos['tipo_reporte']),
                'copia_interna'      => sanitize_textarea_field($datos['copia_interna'] ?? ''),
                'fecha_inicio'       => !empty($datos['fecha_inicio']) ? $datos['fecha_inicio'] : null,
                'fecha_fin'          => !empty($datos['fecha_fin']) ? $datos['fecha_fin'] : null,
                'activo'             => 1,
                'proximo_envio'      => $datos['proximo_envio'] ?? null,
            ],
            [
                '%s', '%s', '%s', '%d', '%s', '%s', '%s', '%s', '%s', '%s',
                '%s', '%s', '%d', '%s'
            ]
        );

        return $resultado ? $wpdb->insert_id : false;
    }

    /**
     * Actualizar configuración existente
     * 
     * @param int $id ID de la configuración
     * @param array $datos Datos a actualizar
     * @return bool True en éxito
     */
    public function actualizar_config($id, $datos)
    {
        global $wpdb;

        $campos_actualizar = [];
        $formatos = [];

        $mapeo = [
            'institucion'        => ['sanitize_text_field', '%s'],
            'nombre_coordinador' => ['sanitize_text_field', '%s'],
            'correo_coordinador' => ['sanitize_email', '%s'],
            'curso_id'           => ['intval', '%d'],
            'curso_nombre'       => ['sanitize_text_field', '%s'],
            'frecuencia'         => ['sanitize_text_field', '%s'],
            'dia_envio'          => ['sanitize_text_field', '%s'],
            'hora_envio'         => ['sanitize_text_field', '%s'],
            'tipo_reporte'       => ['sanitize_text_field', '%s'],
            'copia_interna'      => ['sanitize_textarea_field', '%s'],
            'fecha_inicio'       => null,
            'fecha_fin'          => null,
            'activo'             => ['intval', '%d'],
            'ultimo_envio'       => null,
            'proximo_envio'      => null,
        ];

        foreach ($mapeo as $campo => $config) {
            if (array_key_exists($campo, $datos)) {
                $valor = $datos[$campo];
                if ($config !== null) {
                    $funcion = $config[0];
                    $formato = $config[1];
                    $valor = $funcion($valor);
                } else {
                    $formato = '%s';
                    // Para fechas nulas
                    if ($valor === '' || $valor === null) {
                        $valor = null;
                    }
                }
                $campos_actualizar[$campo] = $valor;
                $formatos[] = $formato;
            }
        }

        if (empty($campos_actualizar)) {
            return false;
        }

        $resultado = $wpdb->update(
            $this->table_config,
            $campos_actualizar,
            ['id' => intval($id)],
            $formatos,
            ['%d']
        );

        return $resultado !== false;
    }

    /**
     * Eliminar configuración
     * 
     * @param int $id ID de la configuración
     * @return bool True en éxito
     */
    public function eliminar_config($id)
    {
        global $wpdb;
        return $wpdb->delete(
            $this->table_config,
            ['id' => intval($id)],
            ['%d']
        ) !== false;
    }

    /**
     * Obtener una configuración por ID
     * 
     * @param int $id ID de la configuración
     * @return array|null
     */
    public function obtener_config($id)
    {
        global $wpdb;
        return $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM {$this->table_config} WHERE id = %d", intval($id)),
            ARRAY_A
        );
    }

    /**
     * Obtener todas las configuraciones
     * 
     * @return array
     */
    public function obtener_todas_configs()
    {
        global $wpdb;
        return $wpdb->get_results(
            "SELECT * FROM {$this->table_config} ORDER BY curso_nombre ASC",
            ARRAY_A
        );
    }

    /**
     * Obtener configuraciones activas que necesitan envío ahora
     * 
     * @return array Configs cuyo proximo_envio <= NOW()
     */
    public function obtener_configs_para_envio()
    {
        global $wpdb;
        $ahora = current_time('mysql');
        return $wpdb->get_results(
            $wpdb->prepare(
                "SELECT * FROM {$this->table_config} 
                 WHERE activo = 1 
                 AND proximo_envio IS NOT NULL 
                 AND proximo_envio <= %s
                 ORDER BY proximo_envio ASC",
                $ahora
            ),
            ARRAY_A
        );
    }

    /**
     * Verificar si ya existe una config para un curso específico
     * 
     * @param int $curso_id ID del curso de Moodle
     * @param int $excluir_id ID a excluir (para edición)
     * @return bool
     */
    public function existe_config_curso($curso_id, $excluir_id = 0)
    {
        global $wpdb;
        $query = $wpdb->prepare(
            "SELECT COUNT(*) FROM {$this->table_config} 
             WHERE curso_id = %d AND id != %d",
            intval($curso_id),
            intval($excluir_id)
        );
        return intval($wpdb->get_var($query)) > 0;
    }

    // =====================================================================
    // CRUD — Tabla de historial
    // =====================================================================

    /**
     * Insertar registro de historial
     * 
     * @param array $datos Datos del envío
     * @return int|false
     */
    public function insertar_historial($datos)
    {
        global $wpdb;

        return $wpdb->insert(
            $this->table_historial,
            [
                'config_id'      => intval($datos['config_id']),
                'curso_id'       => intval($datos['curso_id']),
                'curso_nombre'   => sanitize_text_field($datos['curso_nombre']),
                'coordinador'    => sanitize_text_field($datos['coordinador']),
                'correo_destino' => sanitize_text_field($datos['correo_destino']),
                'tipo_reporte'   => sanitize_text_field($datos['tipo_reporte']),
                'estado'         => sanitize_text_field($datos['estado']),
                'mensaje_error'  => $datos['mensaje_error'] ?? null,
            ],
            ['%d', '%d', '%s', '%s', '%s', '%s', '%s', '%s']
        );
    }

    /**
     * Obtener historial de una config específica
     * 
     * @param int $config_id
     * @param int $limite
     * @return array
     */
    public function obtener_historial_config($config_id, $limite = 50)
    {
        global $wpdb;
        return $wpdb->get_results(
            $wpdb->prepare(
                "SELECT * FROM {$this->table_historial} 
                 WHERE config_id = %d 
                 ORDER BY fecha_envio DESC 
                 LIMIT %d",
                intval($config_id),
                intval($limite)
            ),
            ARRAY_A
        );
    }

    /**
     * Obtener todo el historial (para página de log)
     * 
     * @param int $limite
     * @return array
     */
    public function obtener_historial_completo($limite = 100)
    {
        global $wpdb;
        return $wpdb->get_results(
            $wpdb->prepare(
                "SELECT * FROM {$this->table_historial} 
                 ORDER BY fecha_envio DESC 
                 LIMIT %d",
                intval($limite)
            ),
            ARRAY_A
        );
    }
}
