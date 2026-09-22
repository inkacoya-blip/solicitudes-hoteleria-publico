(function () {
  'use strict';

  var app = document.getElementById('app');
  var MAX_DIMENSION = 1600;
  var JPEG_QUALITY = 0.7;

  var TIPOS = ['Mantenimiento', 'Calidad', 'Personal', 'Equipamiento', 'Infraestructura', 'Seguridad', 'Servicio', 'Otro'];
  var PRIORIDADES = ['Crítica', 'Alta', 'Media', 'Baja'];

  /**
   * Mismo patrón que app.js: el token viaja en el fragmento (#/i/<token>) para que nunca
   * llegue al servidor por URL ni quede en logs de acceso, y se borra de la barra de
   * direcciones de inmediato. Prefijo /i/ distinto de /c/ (solicitudes) solo para que un
   * enlace copiado/pegado se distinga a simple vista — ambas páginas son independientes.
   */
  function extractToken() {
    var match = /^#\/i\/(.+)$/.exec(window.location.hash);
    var token = match ? decodeURIComponent(match[1]) : null;
    if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    return token;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) { node.appendChild(child); });
    return node;
  }

  function renderMessage(box, text, type) {
    if (!box) return;
    box.textContent = text;
    box.className = 'message ' + type;
    box.hidden = false;
  }

  function renderInvalid() {
    app.innerHTML = '';
    app.appendChild(el('h1', { text: 'Enlace no válido' }));
    app.appendChild(el('p', { class: 'subtitle', text: 'Este enlace no está disponible. Pide uno nuevo a tu supervisor.' }));
  }

  function optionsFor(select, values, placeholder) {
    select.appendChild(el('option', { value: '', text: placeholder }));
    values.forEach(function (value) {
      var option = el('option', { value: value, text: value });
      select.appendChild(option);
    });
  }

  /**
   * Redimensiona/comprime la foto en el propio celular antes de enviarla — igual que
   * cualquier foto de WhatsApp, pero controlado acá para que el POST JSON (base64) nunca
   * sea gigante. Sin esto, una foto de celular moderna (varios MB) haría el envío lento
   * o fallaría contra el límite de subida directa de Graph (4 MB).
   */
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('No se pudo leer la foto.')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('No se pudo procesar la foto.')); };
        img.onload = function () {
          var scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
          var width = Math.round(img.width * scale);
          var height = Math.round(img.height * scale);
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          var dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
          var base64 = dataUrl.split(',')[1] || '';
          resolve({ base64: base64, contentType: 'image/jpeg' });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function newSubmissionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    // Reserva para navegadores muy antiguos sin crypto.randomUUID — no necesita ser criptográfico, solo único.
    return 'sub-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function renderForm(token, data) {
    app.innerHTML = '';
    var submissionId = newSubmissionId();

    app.appendChild(el('div', { class: 'form-body' }, [
      el('h1', { text: 'Reportar incidencia' }),
      el('p', { class: 'subtitle', text: data.establecimientoNombre || 'Establecimiento' })
    ]));

    var body = app.querySelector('.form-body');

    var tipoSelect = el('select', { id: 'tipo' });
    optionsFor(tipoSelect, TIPOS, 'Selecciona un tipo');
    body.appendChild(el('label', { for: 'tipo', text: 'Tipo de problema' }));
    body.appendChild(tipoSelect);

    var prioridadSelect = el('select', { id: 'prioridad' });
    optionsFor(prioridadSelect, PRIORIDADES, 'Selecciona una prioridad');
    body.appendChild(el('label', { for: 'prioridad', text: 'Prioridad' }));
    body.appendChild(prioridadSelect);

    var afectaLabel = el('label', { style: 'font-weight:normal;display:flex;align-items:center;gap:8px;' });
    var afectaCheckbox = el('input', { type: 'checkbox', id: 'afecta' });
    afectaLabel.appendChild(afectaCheckbox);
    afectaLabel.appendChild(document.createTextNode('Afecta la continuidad del servicio'));
    body.appendChild(afectaLabel);

    var descripcionTextarea = el('textarea', { id: 'descripcion', placeholder: 'Describe lo que encontraste' });
    body.appendChild(el('label', { for: 'descripcion', text: 'Descripción' }));
    body.appendChild(descripcionTextarea);

    var nombreInput = el('input', { type: 'text', id: 'nombre', placeholder: 'Tu nombre' });
    body.appendChild(el('label', { for: 'nombre', text: 'Quién reporta' }));
    body.appendChild(nombreInput);

    var fotoInput = el('input', { type: 'file', id: 'foto', accept: 'image/*', capture: 'environment' });
    body.appendChild(el('label', { for: 'foto', text: 'Foto (opcional)' }));
    body.appendChild(fotoInput);

    var honeypot = el('input', { type: 'text', name: 'sitioWeb', class: 'honeypot', tabindex: '-1', autocomplete: 'off' });
    body.appendChild(honeypot);

    var submitButton = el('button', { type: 'button', text: 'Enviar incidencia' });
    body.appendChild(submitButton);

    var messageBox = el('div', { class: 'message', hidden: 'true' });
    body.appendChild(messageBox);

    submitButton.addEventListener('click', function () {
      var tipo = tipoSelect.value;
      var prioridad = prioridadSelect.value;
      var descripcion = descripcionTextarea.value.trim();
      var reportadoPor = nombreInput.value.trim();

      if (!tipo || !prioridad || !descripcion || !reportadoPor) {
        renderMessage(messageBox, 'Completa tipo, prioridad, descripción y tu nombre.', 'error');
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = 'Enviando…';

      var photoPromise = fotoInput.files && fotoInput.files[0]
        ? compressImage(fotoInput.files[0])
        : Promise.resolve(null);

      photoPromise
        .catch(function () {
          renderMessage(messageBox, 'No se pudo procesar la foto — se enviará el reporte sin ella.', 'error');
          return null;
        })
        .then(function (photo) {
          return fetch('/api/incidents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: token,
              submissionId: submissionId,
              tipo: tipo,
              prioridad: prioridad,
              afectaContinuidad: afectaCheckbox.checked,
              descripcion: descripcion,
              reportadoPor: reportadoPor,
              fotoBase64: photo ? photo.base64 : undefined,
              fotoContentType: photo ? photo.contentType : undefined,
              sitioWeb: honeypot.value
            })
          });
        })
        .then(function (response) { return response.json(); })
        .then(function (result) {
          if (result && result.ok) {
            renderMessage(messageBox, result.message || 'Incidencia registrada.', 'success');
            descripcionTextarea.value = '';
            nombreInput.value = reportadoPor;
            fotoInput.value = '';
            tipoSelect.value = '';
            prioridadSelect.value = '';
            afectaCheckbox.checked = false;
            submissionId = newSubmissionId();
          } else {
            renderMessage(messageBox, (result && result.message) || 'No fue posible registrar la incidencia.', 'error');
          }
        })
        .catch(function () {
          renderMessage(messageBox, 'No fue posible enviar el reporte. Revisa tu conexión e inténtalo de nuevo.', 'error');
        })
        .finally(function () {
          submitButton.disabled = false;
          submitButton.textContent = 'Enviar incidencia';
        });
    });
  }

  function init() {
    var token = extractToken();
    if (!token) { renderInvalid(); return; }

    fetch('/api/incident-channel/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (!data || !data.ok) { renderInvalid(); return; }
        renderForm(token, data);
      })
      .catch(function () { renderInvalid(); });
  }

  init();
})();
