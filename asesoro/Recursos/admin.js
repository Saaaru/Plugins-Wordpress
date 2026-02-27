jQuery(document).ready(function ($) {
    var mediaUploader;

    $('#srl_upload_btn').click(function (e) {
        e.preventDefault();

        // Si ya está abierto, usarlo
        if (mediaUploader) {
            mediaUploader.open();
            return;
        }

        // Crear el objeto media frame
        mediaUploader = wp.media.frames.file_frame = wp.media({
            title: 'Seleccionar Archivo para Descargar',
            button: {
                text: 'Usar este archivo'
            },
            multiple: false
        });

        // Cuando se selecciona un archivo
        mediaUploader.on('select', function () {
            var attachment = mediaUploader.state().get('selection').first().toJSON();
            // Poner la URL en el input
            $('#srl_file_url_field').val(attachment.url);
        });

        // Abrir
        mediaUploader.open();
    });
});