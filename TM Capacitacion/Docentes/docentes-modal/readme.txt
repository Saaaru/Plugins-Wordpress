=== Docentes Modal Manager ===
Contributors: Solvitu
Tags: docentes, modal, ajax, custom-post-type
Requires at least: 5.8
Tested up to: 6.4
Stable tag: 1.0.0
Requires PHP: 7.4
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Gestión de fichas de docentes con modal AJAX.

== Description ==

Este plugin permite gestionar fichas de docentes mediante un Custom Post Type. Ofrece un diseño en grilla mediante shortcode y carga la información detallada del docente en una ventana modal vía AJAX, mejorando la experiencia de usuario y la velocidad de carga.

== Installation ==

1. Sube la carpeta del plugin al directorio `/wp-content/plugins/`.
2. Activa el plugin desde el menú 'Plugins' de WordPress.
3. Usa el shortcode `[docentes_grid]` para mostrar la grilla de docentes.

== Frequently Asked Questions ==

= ¿Cómo añado un nuevo docente? =
Ve al menú "Docentes" en el panel de administración y haz clic en "Añadir Nuevo".

= ¿Cómo cambio el número de columnas? =
Usa el atributo `columnas` en el shortcode, por ejemplo: `[docentes_grid columnas="4"]`.

== Changelog ==

= 1.0.0 =
* Versión inicial.
