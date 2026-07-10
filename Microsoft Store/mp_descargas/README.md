# 📥 MP Tools para Mercado Público (Compra Ágil) v4.2.0

Una potente y sofisticada extensión de Chrome/Edge diseñada para optimizar, automatizar y agilizar tareas críticas dentro del portal de [Mercado Público](https://www.mercadopublico.cl/), específicamente en el módulo de **Compra Ágil**. Esta herramienta agrupa cuatro funcionalidades clave en una única solución integrada que ahorra horas de trabajo manual.

---

## 🎯 Pilares y Funcionalidades Clave

```mermaid
graph TD
    A[MP Tools Extension] --> B[1. Descarga Masiva]
    A --> C[2. Carga Masiva]
    A --> D[3. Resaltado & Auto-Rechazo]
    A --> E[4. Exportación de Ofertas]

    B --> B1[Captura automática de tokens]
    B --> B2[Filtro inteligente de Inadmisibles]
    B --> B3[Organización jerárquica de carpetas]
    B --> B4[Progreso de descarga en tiempo real]

    C --> C1[Lectura TSV / Portapapeles Excel]
    C --> C2[Inyección directa en React State]
    C --> C3[Automatización de Comboboxes MUI]

    D --> D1[Scraping de presupuestos en tiempo real]
    D --> D2[Resaltado de ofertas fuera de rango]
    D --> D3[Robot de Auto-Rechazo en 5 pasos]

    E --> E1[Extracción de datos de cada oferta]
    E --> E2[Exportación a CSV compatible con Excel]
    E --> E3[BOM UTF-8 para acentos correctos]
```

### 1. 📂 Descarga Masiva de Adjuntos
Agrega botones automatizados para descargar archivos y ofertas de forma masiva y organizada.
* **Descarga de Oferta Individual**: Obtiene todos los documentos vinculados a una cotización específica con un solo clic mediante el botón `📥 Descargar todo`.
* **Descarga Masiva de Todas las Ofertas**: Agrega un botón global `📥 Descargar todas las ofertas` al lado del indicador de llamado.
* **Organización Dinámica e Inteligente**: Crea carpetas ordenadas automáticamente en tu directorio de descargas:
  $$\text{Ruta: }\texttt{Downloads/\{Código\_Cotización\}/\{Razón\_Social\_Proveedor\}/\{Nombre\_Archivo\}}$$
  *(Ejemplo: `Downloads/2284-145-COT26/Proveedor_SPA/ficha_tecnica.pdf`)*
* **Filtro Avanzado de Inadmisibilidad**: La descarga masiva omite automáticamente aquellas ofertas que hayan sido declaradas como **INADMISIBLE** (ya sea de forma manual o mediante el robot de auto-rechazo), ahorrando ancho de banda y almacenamiento.
* **Progreso en Tiempo Real**: Durante la descarga masiva, el botón muestra el avance en vivo (`⏳ Descargando oferta 3/10 (12 archivos)...`) y el modal final informa la cantidad exacta de archivos descargados.
* **Feedback Visual Inmediato**: Un modal informativo emergente avisa al usuario una vez que el proceso masivo ha concluido con éxito.

### 2. 📋 Carga Masiva desde Excel
Permite copiar filas y columnas con datos de productos o cotizaciones desde Microsoft Excel o Google Sheets y pegarlas directamente en los formularios web de Mercado Público.
* **Compatibilidad Estricta**: Soporta formatos delimitados por tabulaciones (TSV) y punto y coma (`;`).
* **Sincronización con el State de React**: Rompe la barrera del DOM virtual actualizando el `_valueTracker` interno de React para asegurar que los cambios se guarden y procesen correctamente.
* **Mapeo Inteligente de Campos**: Rellena automáticamente campos de cantidad (`input[type="number"]`), detalle (`textarea`) y selecciona la unidad de medida interactuando con los complejos componentes `MuiPopover` y `combobox` de Material UI.
* **Plantilla Lista para Usar**: Incluye un enlace de descarga directa a una plantilla oficial en la nube para garantizar una carga libre de errores.

### 3. 🤖 Automatización y Resaltado Inteligente de Ofertas
Analiza el presupuesto oficial cargado en la ficha y evalúa cada oferta económica recibida en tiempo real de manera autónoma.
* **Detección Automática**: Identifica el monto de presupuesto estimado o disponible y el tipo de presupuesto establecido por el organismo público.
* **Semáforo de Alertas Visuales**:
  * 🔴 **Rojo (Presupuesto Disponible Excedido)**: Ofertas que superan el presupuesto límite de compra. Inyecta una etiqueta de advertencia y habilita el botón de auto-descarte.
  * 🟡 **Amarillo (Presupuesto Estimado Excedido)**: Ofertas que superan en un 30% el valor estimado de referencia.
* **Robot de Auto-Rechazo (Flujo Asíncrono de 5 Pasos)**:
  1. Activa el flujo haciendo clic en `🤖 Auto-Rechazar` en la tarjeta marcada.
  2. Selecciona automáticamente la causal de rechazo por presupuesto.
  3. Confirma la primera ventana modal de descarte.
  4. Monitorea y espera la aparición de la advertencia irreversible mediante un `MutationObserver`.
  5. Realiza la confirmación final del descarte, todo en menos de 2 segundos de forma segura.

### 4. 📊 Exportación de Ofertas a Excel/CSV
Extrae y consolida automáticamente los datos de todas las ofertas visibles en el cuadro comparativo y los exporta a un archivo CSV listo para abrir en Microsoft Excel.
* **Botón Dedicado**: Se inyecta un botón verde `📊 Exportar tabla a Excel` junto al de descarga masiva.
* **Datos Capturados por Oferta**:
  * Razón Social del proveedor.
  * RUT (formato chileno `XX.XXX.XXX-X`).
  * Descripción de la oferta.
  * Vigencia de la oferta.
  * Monto total.
  * Estado de inadmisibilidad (`SÍ` / `NO`).
* **Compatibilidad Total con Excel**: Genera un archivo delimitado por punto y coma (`;`) con marca de orden de bytes UTF-8 (BOM) para garantizar que los acentos y caracteres especiales se visualicen correctamente al abrirlo.
* **Naming Automático**: El archivo se nombra automáticamente con el código de cotización (ej. `Ofertas_2284-145-COT26.csv`).

---

## 🛠️ Arquitectura del Proyecto

El desarrollo se rige bajo una arquitectura modular y reactiva optimizada para Manifest V3 de Chrome/Edge:

| Archivo | Contexto | Responsabilidad Principal |
| :--- | :--- | :--- |
| **[`manifest.json`](manifest.json)** | Extensión | Configuración global, permisos de descargas, inyección y declaración de recursos. |
| **[`api_interceptor.js`](api_interceptor.js)** | Página Principal | Intercepta `window.fetch` y `XMLHttpRequest` para extraer payloads y tokens de portación (`Authorization`). |
| **[`content.js`](content.js)** | Script de Contenido | Funciona como puente. Inyecta elementos UI de descarga/exportación y canaliza los tokens al Background. |
| **[`background.js`](background.js)** | Service Worker | Orquesta la descarga asíncrona concurrente de archivos pesados respetando límites de tasa (rate-limiting) y reporta progreso. |
| **[`bulk_editor.js`](bulk_editor.js)** | Script de Contenido | Procesa el portapapeles y ejecuta la simulación de entrada e interacciones en formularios React. |
| **[`highlight_offers.js`](highlight_offers.js)** | Script de Contenido | Analiza el DOM, evalúa reglas de presupuesto, colorea la interfaz e impulsa el robot de descarte. |

---

## 📦 Instalación (Modo Desarrollador)

1. Descarga o clona este repositorio en tu máquina local.
2. Abre Google Chrome o Microsoft Edge y dirígete al panel de administración de extensiones:
   * Chrome: `chrome://extensions/`
   * Edge: `edge://extensions/`
3. Activa el interruptor de **"Modo desarrollador"** (Developer Mode) en la esquina superior derecha.
4. Presiona el botón **"Cargar descomprimida"** (Load unpacked).
5. Selecciona la carpeta raíz del proyecto (`mp_descargas`).
6. ¡Listo! La extensión se activará automáticamente al navegar por Mercado Público.

---

## 🚀 Guía Rápida de Uso

> [!IMPORTANT]
> Para el correcto funcionamiento de la descarga masiva, la extensión requiere que el usuario haya iniciado sesión en Mercado Público. Los tokens se capturan dinámicamente de forma automática en el primer request que la página realiza a las APIs oficiales del portal.

### 📥 Descarga Masiva
1. Ve a la ficha de ofertas o al módulo de adjuntos de cualquier cotización.
2. La extensión detectará los adjuntos y pintará un botón azul con el texto **`📥 Descargar todo`** (oferta individual) o **`📥 Descargar todas las ofertas`** (todas las ofertas del llamado).
3. Haz clic y observa cómo se descargan los archivos en subcarpetas de manera estructurada. El botón mostrará el progreso en tiempo real.

### 📋 Carga Masiva (Excel)
1. Presiona el botón flotante superior derecho **`📋 Carga Masiva`**.
2. Copia tus datos directamente desde Excel usando la plantilla oficial.
3. Pega los datos en la caja de texto y haz clic en **`⚡ Ejecutar Carga`**.

### 📊 Exportación de Ofertas
1. En la pantalla del cuadro comparativo de ofertas, busca el botón verde **`📊 Exportar tabla a Excel`** (junto al botón de descarga masiva).
2. Haz clic y el archivo CSV se descargará automáticamente con todos los datos de las ofertas.

### 🤖 Resaltado y Auto-Rechazo
* No requiere acción del usuario. Se ejecuta de fondo en las pantallas de Cuadros Comparativos.
* Si una oferta excede el presupuesto disponible y requiere rechazo, haz clic en **`🤖 Auto-Rechazar`** para descartar la oferta en segundos con la causal correcta de manera automatizada.

---

## 🔒 Privacidad y Seguridad

* **Ejecución 100% Local**: La extensión no recopila, procesa ni envía datos a servidores externos. Todo el procesamiento y las descargas ocurren estrictamente dentro de tu navegador web.
* **Seguridad de Credenciales**: No se almacenan claves, cookies ni tokens persistentes. El token de autorización (`Authorization: Bearer ...`) es temporal, reside únicamente en memoria y se autodestruye al cerrar o refrescar la pestaña.
* **Aislamiento de Contexto**: La extensión solo tiene permisos activos en el dominio oficial `*.mercadopublico.cl`.

---

## 📝 Registro de Cambios (Changelog)

### v4.2.0
* ✨ **Nuevo**: Exportación de ofertas a Excel/CSV (`📊 Exportar tabla a Excel`) con datos completos de proveedor, RUT, vigencia, monto e inadmisibilidad.
* ✨ **Nuevo**: Indicador de progreso de descarga en tiempo real durante la descarga masiva.
* ✨ **Nuevo**: El modal de finalización ahora reporta la cantidad exacta de archivos descargados.
* 🐛 **Corregido**: Se restauró la inyección del botón `📥 Descargar todo` (descarga individual de adjuntos) que estaba roto por una función faltante.
* 🛠️ **Mejora**: Reporte de progreso bidireccional entre el Service Worker y el script de contenido.

### v4.1.1
* Filtro automático de ofertas INADMISIBLES en la descarga masiva.
* Modal de finalización de descargas.

### v4.1.0
* Robot de Auto-Rechazo asíncrono de 5 pasos.
* Resaltado de ofertas según tipo de presupuesto (Disponible/Estimado).

---

*Desarrollado profesionalmente para agilizar la gestión operativa en Mercado Público del Estado de Chile.*
