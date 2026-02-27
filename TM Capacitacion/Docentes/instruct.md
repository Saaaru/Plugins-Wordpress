Aquí tienes el **Prompt Maestro definitivo**. Está formateado en Markdown, listo para que lo copies y lo pegues en un chat con un modelo de IA (ChatGPT, Claude, DeepSeek) o se lo entregues a un desarrollador.

Este prompt incluye la **lógica de plantillas** para que, al crear un nuevo docente, aparezca automáticamente el diseño que describiste (columnas, foto, lista, galería), pero permitiendo editarlo libremente.

***

# 📋 PROMPT TÉCNICO: Plugin "Docentes Modal Manager"

**Rol:** Desarrollador WordPress Senior / Ingeniero de Software.
**Objetivo:** Crear un plugin de WordPress para gestionar fichas de equipo/docentes y mostrarlas en un modal elegante vía AJAX.

---

## 🎯 Resumen del Proyecto
Necesito un plugin que permita administrar perfiles de docentes.
1.  **Backend:** Al crear un docente, el editor de bloques debe precargar una **plantilla de diseño predefinida** (Layout de columnas, imagen, biografía, galería).
2.  **Frontend:** Un shortcode muestra tarjetas simples. Al hacer clic, se abre un **Modal** que carga el contenido detallado diseñado en el backend.

---

## 1️⃣ Especificaciones Generales
*   **Nombre del Plugin:** `Docentes Modal Manager`
*   **Slug:** `docentes-modal`
*   **Namespace PHP:** `DocentesModal`
*   **Requisitos:** PHP 8.2+, WordPress 6.4+, Sin jQuery (Vanilla JS).

### Estructura de Archivos
```text
docentes-modal/
│
├── docentes-modal.php       # Archivo principal
├── includes/
│   ├── class-cpt.php        # Registro del Post Type + Plantilla de Bloques
│   ├── class-shortcode.php  # Renderizado de la grilla
│   └── class-assets.php     # Encolado de scripts y estilos
├── assets/
│   ├── css/
│   │   └── modal.css        # Estilos del modal y la grilla
│   └── js/
│       └── modal.js         # Lógica AJAX y UI
└── templates/
    └── modal-skeleton.php   # HTML base del modal (oculto)
```

---

## 2️⃣ Custom Post Type y Plantilla (CRÍTICO)

**Archivo:** `includes/class-cpt.php`
Registrar CPT: `docente`.

**Configuración:**
*   `public` => `false` (No queremos URL directa accesible).
*   `show_ui` => `true` (Visible en admin).
*   `show_in_rest` => `true` (Habilitar Gutenberg).
*   `supports` => `['title', 'editor', 'thumbnail', 'excerpt']`.

**⭐️ Requisito Especial: Block Template**
Al registrar el CPT, debes definir el argumento `template` para que aparezca el siguiente diseño por defecto:

1.  **Columns Block (50/50):**
    *   *Columna 1:* **Image Block** (Placeholder, estilo redondeado).
    *   *Columna 2:*
        *   **Heading H3:** "Biografía".
        *   **List Block:** (Viñetas para estudios/certificaciones).
        *   **Separator Block.**
2.  **Heading H4:** "Cursos Relacionados".
3.  **Gallery Block:** (3 columnas).

*Nota: No usar `template_lock` para permitir que el usuario edite o borre bloques libremente.*

---

## 3️⃣ Shortcode (Grid Disparador)

**Archivo:** `includes/class-shortcode.php`
**Shortcode:** `[docentes_grid columnas="3"]`

**Lógica:**
1.  Query `WP_Query` para obtener posts tipo `docente`.
2.  Renderizar contenedor grid.
3.  Cada item (`.dm-card`) debe tener:
    *   Imagen Destacada (`the_post_thumbnail`).
    *   Título (`h3`).
    *   Extracto corto (`the_excerpt`).
    *   **Botón Disparador:** `<button class="dm-trigger" data-id="{ID}">Ver Perfil</button>`.

---

## 4️⃣ Interfaz del Modal (UI/UX)

**Archivo:** `templates/modal-skeleton.php` (Inyectar en `wp_footer`).

**Diseño HTML/CSS:**
El modal debe cumplir estrictamente con esta descripción visual:
*   **Contenedor:** Fondo blanco, bordes redondeados (10-15px), sombra paralela suave (`box-shadow`).
*   **Header:**
    *   Izquierda: Título del Docente (`h2`).
    *   Derecha: Icono de cierre (X).
*   **Body:**
    *   Área con scroll interno (`overflow-y: auto`).
    *   Aquí se inyectará el contenido traído por AJAX.
*   **Footer:**
    *   Alineado a la derecha.
    *   Botón "Cerrar" azul vibrante (`background-color: #0073aa`, texto blanco).

**CSS:**
*   Usar prefijo BEM (`.dm-modal__...`).
*   Asegurar compatibilidad móvil (en móvil pasa a 1 columna y ocupa casi toda la pantalla).

---

## 5️⃣ Lógica JavaScript (AJAX Optimizado)

**Archivo:** `assets/js/modal.js`

**Flujo:**
1.  Escuchar clic en `.dm-trigger`.
2.  Mostrar el modal con un **spinner de carga** visible en el cuerpo.
3.  Hacer Fetch a la REST API: `/wp-json/wp/v2/docente/{ID}`.
    *   *No necesitamos `_embed` si la imagen ya está dentro del contenido del editor, pero si se requiere imagen destacada extra, úsalo.*
4.  **Al recibir datos:**
    *   Actualizar Título del Header con `data.title.rendered`.
    *   Inyectar Contenido en el Body con `data.content.rendered`.
5.  **Manejo de Cierre:**
    *   Clic en la X, clic en botón azul "Cerrar", clic fuera del modal (overlay) o tecla `ESC`.

---

## 6️⃣ Detalles Técnicos

1.  **Seguridad:** Pasar `nonce` de WP REST API mediante `wp_localize_script`.
2.  **Estilos de Bloques:** Asegurarse de que el CSS del modal soporte las clases nativas de WordPress (`.wp-block-columns`, `.wp-block-gallery`, etc.) para que el contenido inyectado se vea bien.
3.  **Accesibilidad:**
    *   `aria-modal="true"`.
    *   Focus trap (al abrir, el foco va al modal; al cerrar, vuelve al botón disparador).

---

## 🚀 Entregable
Código completo del plugin listo para comprimir en `.zip` e instalar. Código comentado y limpio.