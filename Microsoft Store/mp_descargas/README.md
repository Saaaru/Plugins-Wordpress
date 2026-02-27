# 📥 Herramientas para Mercado Público (MP Tools)

Una potente extensión de Chrome diseñada para optimizar y automatizar tareas críticas en el portal de [Mercado Público](https://www.mercadopublico.cl/). Esta herramienta agrupa tres funcionalidades clave en una única solución integrada.

## 🎯 ¿Qué hace esta extensión?

Esta extensión mejora significativamente la eficiencia operativa al trabajar con cotizaciones y licitaciones, ofreciendo tres pilares fundamentales:

### 1. 📂 Descarga Masiva de Adjuntos
Agrega un botón "📥 Descargar Todas Las Ofertas" que permite bajar todos los documentos de una cotización de forma organizada.
- ✅ Captura automática de tokens de sesión.
- ✅ **Organización Dinámica**: Crea carpetas basadas en el ID de la cotización (ej: `2284-145-COT26`) y dentro subcarpetas por proveedor.
- ✅ **Filtro Inteligente**: Detecta ofertas marcadas como "INADMISIBLE" (manual o automáticamente) y las omite de la descarga masiva para ahorrar tiempo y espacio.
- ✅ Feedback visual mediante modal al finalizar el proceso.

### 2. 📋 Carga Masiva desde Excel
Permite copiar datos (Cantidad, Unidad, Detalle) directamente desde Excel y pegarlos en los formularios de Mercado Público.
- ✅ Inyección inteligente en campos de React/Material UI.
- ✅ Plantilla de Excel incluida para facilitar el trabajo.
- ✅ Ahorra horas de ingreso manual de datos en cotizaciones largas.

### 3. 🤖 Automatización y Resaltado de Ofertas
Analiza automáticamente el presupuesto y permite gestionar las ofertas fuera de rango con un robot inteligente.
- 🔴 **Rojo**: Ofertas que superan el presupuesto "Disponible".
- 🟡 **Amarillo**: Ofertas que superan en un 30% el presupuesto "Estimado".
- 🤖 **Auto-Rechazo**: Botón automatizado que abre los modales, selecciona el motivo de rechazo por presupuesto y confirma la inadmisibilidad en segundos.
- ✅ Notas aclaratorias integradas en la visualización de la oferta.

## 🛠️ Arquitectura del Proyecto

El proyecto está estructurado de forma modular para facilitar su mantenimiento:

1. **`manifest.json`**: Configuración principal de la extensión (V3).
2. **`content.js`**: Gestiona la lógica de descarga de adjuntos e inyección de botones.
3. **`bulk_editor.js`**: Contiene la lógica para la carga masiva de datos desde el portapapeles.
4. **`highlight_offers.js`**: Script encargado del análisis de presupuesto y resaltado visual.
5. **`api_interceptor.js`**: Intercepta las comunicaciones con la API para obtener tokens de seguridad.

## 📦 Instalación

### Modo Desarrollador (Manual):

1. Descarga o clona este repositorio.
2. Abre tu navegador (Chrome o Edge) y ve a la gestión de extensiones:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
3. Activa el **"Modo desarrollador"** (interruptor en la parte superior derecha).
4. Haz clic en **"Cargar descomprimida"**.
5. Selecciona la carpeta raíz de este proyecto.

## 🚀 Guía de Uso

### Para Descarga Masiva:
- Navega a la sección de adjuntos de cualquier cotización.
- Haz clic en el botón azul **"📥 Descargar todos los adjuntos"**.

### Para Carga Masiva (Excel):
- Haz clic en el botón flotante **"📋 Carga Masiva"** en la esquina superior derecha.
- Descarga la plantilla (opcional).
- Pega los datos del Excel en el cuadro de texto y haz clic en **"⚡ Ejecutar Carga"**.

### Para Resaltado de Ofertas:
- No requiere acción. Se activa automáticamente al visualizar el "Cuadro Comparativo" o las ofertas de una ficha.

## 🔧 Configuración Técnica

Puedes ajustar el comportamiento en `content.js` y otros archivos JS:
- `downloadInterval`: Tiempo de espera entre descargas (default: 1000ms).
- Umbrales de resaltado: Editables en `highlight_offers.js`.

## 🔒 Seguridad y Privacidad

- **100% Local**: No se envían datos a servidores externos. Todo ocurre en tu navegador.
- **Sin Almacenamiento**: No guardamos contraseñas ni tokens de Mercado Público.
- **Contexto**: Solo se activa en dominios `*.mercadopublico.cl`.

## 🤝 Contribuciones

¿Quieres mejorar la herramienta?
1. Haz un Fork del proyecto.
2. Crea una rama para tu mejora (`git checkout -b feature/mejora`).
3. Envía un Pull Request describiendo los cambios.

## 📄 Licencia

Este proyecto es de código abierto y está disponible bajo la licencia **MIT**.

## ⚠️ Descargo de responsabilidad

Esta extensión es una herramienta **no oficial** y no está vinculada a la Dirección de Compras y Contratación Pública (ChileCompra). Su propósito es facilitar la navegación y gestión de datos públicos. Úsala de acuerdo con los términos de servicio del sitio oficial.

---

**Desarrollado con ❤️ para optimizar la gestión en Mercado Público**

