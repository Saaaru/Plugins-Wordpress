=== Librería de Recursos ===
Contributors: Solvitu
Tags: recursos, descargas, pdf, lead-magnet, library
Requires at least: 5.8
Tested up to: 6.4
Stable tag: 1.2
Requires PHP: 7.4
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Librería de recursos descargables con segmentación por formulario.

== Description ==

Este plugin permite crear una librería de recursos descargables (PDFs, eBooks, documentos, etc.) organizados por categorías.

Muestra una librería filtrable que permite bloquear la descarga tras completar un formulario (compatible con shortcodes de formularios como MailPoet o Contact Form 7), lo que facilita la segmentación de usuarios.

Características:
*   Custom Post Type "Recursos".
*   Taxonomía "Categorías" para filtrar.
*   Campo para subir archivo y badge de tipo de archivo.
*   Integración con formularios mediante shortcodes (global o por recurso).
*   Shortcode `[ver_recursos]` para mostrar la grilla de recursos con filtros.

== Installation ==

1. Sube la carpeta del plugin al directorio `/wp-content/plugins/`.
2. Activa el plugin desde el menú 'Plugins' de WordPress.
3. Configura el formulario por defecto en Recursos > Ajustes.
4. Usa el shortcode `[ver_recursos]` para mostrar la galería.

== Frequently Asked Questions ==

= ¿Cómo cambio el formulario por defecto? =
Ve a Recursos -> Ajustes y define el shortcode del formulario que quieres usar por defecto.

= ¿Puedo usar un formulario diferente para un recurso específico? =
Sí, al editar el recurso hay un campo para sobrescribir el shortcode del formulario. Si se deja vacío, se usará el formulario global.

== Changelog ==

= 1.2 =
*   Mejoras de seguridad y cumplimiento GPLv2.
*   Añadida seguridad con nonces.
*   Mejoras de internacionalización.
*   Cumplimiento de estándares de WordPress.org.

= 1.0 =
*   Versión inicial.
