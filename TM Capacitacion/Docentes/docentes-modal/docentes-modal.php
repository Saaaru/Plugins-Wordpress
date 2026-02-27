<?php
/**
 * Plugin Name: Docentes Modal Manager
 * Description: Gestión de fichas de docentes con modal AJAX.
 * Version: 1.0.0
 * Author: Solvitu
 * Text Domain: docentes-modal
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'DOCENTES_MODAL_PATH', plugin_dir_path( __FILE__ ) );
define( 'DOCENTES_MODAL_URL', plugin_dir_url( __FILE__ ) );
define( 'DOCENTES_MODAL_VERSION', '1.0.0' );

// Autoloader simplificado
spl_autoload_register( function ( $class ) {
	$prefix = 'DocentesModal\\';
	$base_dir = DOCENTES_MODAL_PATH . 'includes/';

	$len = strlen( $prefix );
	if ( strncmp( $prefix, $class, $len ) !== 0 ) {
		return;
	}

	$relative_class = substr( $class, $len );
	$file = $base_dir . 'class-' . strtolower( str_replace( '_', '-', $relative_class ) ) . '.php';

	if ( file_exists( $file ) ) {
		require $file;
	}
} );

// Inicializar componentes
function docentes_modal_init() {
	new \DocentesModal\CPT();
	new \DocentesModal\Shortcode();
	new \DocentesModal\Assets();
}
add_action( 'plugins_loaded', 'docentes_modal_init' );
