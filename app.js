(function () {
  'use strict';

  var app = document.getElementById('app');
  var submissionId = null;

  /**
   * El token viaja en el fragmento (#/c/<token>) para que nunca llegue al servidor
   * por URL ni quede en logs de acceso. Se borra de la barra de direcciones de
   * inmediato con history.replaceState — desde acá en adelante solo vive en memoria
   * y se manda en el CUERPO de cada POST, nunca en una URL.
   */
  function extractToken() {
    var match = /^#\/c\/(.+)$/.exec(window.location.hash);
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

  function renderMessage(text, type) {
    var box = document.getElementById('message-box');
    if (!box) return;
    box.textContent = text;
    box.className = 'message ' + type;
    box.hidden = false;
  }

  function renderInvalid() {
    app.innerHTML = '';
    app.appendChild(el('h1', { text: 'Enlace no válido' }));
    app.appendChild(el('p', { class: 'subtitle', text: 'Este enlace no está disponible. Pide uno nuevo a Inka Coya.' }));
  }

  function tomorrowIso() {
    var d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  function renderForm(data, token) {
    submissionId = crypto.randomUUID();
    app.innerHTML = '';
    app.appendChild(el('h1', { text: data.clienteNombre || 'Solicitud diaria' }));
    app.appendChild(el('p', { class: 'subtitle', text: 'Envía o modifica hasta las 18:00 del día anterior. Para reemplazar, usa la misma fecha.' }));

    var form = el('form', {});

    var fechaLabel = el('label', { text: 'Fecha del servicio', for: 'fecha' });
    var fecha = el('input', { type: 'date', id: 'fecha', name: 'fecha', value: tomorrowIso(), required: 'required' });
    form.appendChild(fechaLabel);
    form.appendChild(fecha);

    var tipoLabel = el('label', { text: 'Tipo de envío' });
    var radioRow = el('div', { class: 'radio-row' });
    ['Solicitud diaria', 'Reemplazo'].forEach(function (value, index) {
      var id = 'tipo-' + index;
      var input = el('input', { type: 'radio', name: 'tipoSolicitud', id: id, value: value });
      if (index === 0) input.checked = true;
      var label = el('label', { for: id }, [input, document.createTextNode(value)]);
      radioRow.appendChild(label);
    });
    form.appendChild(tipoLabel);
    form.appendChild(radioRow);

    var motivoLabel = el('label', { text: 'Motivo del reemplazo', id: 'motivo-label' });
    var motivo = el('textarea', { name: 'motivoReemplazo', id: 'motivo' });
    motivoLabel.hidden = true;
    motivo.hidden = true;
    form.appendChild(motivoLabel);
    form.appendChild(motivo);
    radioRow.addEventListener('change', function () {
      var isReemplazo = form.querySelector('input[name="tipoSolicitud"]:checked').value === 'Reemplazo';
      motivoLabel.hidden = !isReemplazo;
      motivo.hidden = !isReemplazo;
    });

    var serviceInputs = {};
    (data.servicios || []).forEach(function (servicio) {
      var id = 'servicio-' + servicio.replace(/\s+/g, '-');
      var label = el('label', { text: servicio, for: id });
      var input = el('input', { type: 'number', min: '0', step: '1', id: id, name: id, value: '0' });
      serviceInputs[servicio] = input;
      form.appendChild(label);
      form.appendChild(input);
    });

    form.appendChild(el('label', { text: 'Nombre de quien solicita (opcional)', for: 'nombre' }));
    var nombre = el('input', { type: 'text', id: 'nombre', name: 'nombre' });
    form.appendChild(nombre);

    form.appendChild(el('label', { text: 'Correo (opcional)', for: 'correo' }));
    var correo = el('input', { type: 'email', id: 'correo', name: 'correo' });
    form.appendChild(correo);

    // Honeypot: un visitante real nunca ve ni llena este campo.
    var honeypot = el('input', { type: 'text', name: 'sitioWeb', class: 'honeypot', tabindex: '-1', autocomplete: 'off' });
    form.appendChild(honeypot);

    var submit = el('button', { type: 'submit', text: 'Enviar solicitud' });
    form.appendChild(submit);

    var messageBox = el('div', { id: 'message-box', class: 'message', hidden: 'hidden' });
    form.appendChild(messageBox);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var servicios = Object.keys(serviceInputs)
        .map(function (name) { return { tipoServicio: name, cantidad: Number(serviceInputs[name].value || 0) }; })
        .filter(function (item) { return item.cantidad > 0; });

      if (servicios.length === 0) {
        renderMessage('Ingresa al menos una cantidad mayor a cero.', 'error');
        return;
      }

      submit.disabled = true;
      submit.textContent = 'Enviando…';

      fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token,
          submissionId: submissionId,
          fechaServicio: fecha.value,
          tipoSolicitud: form.querySelector('input[name="tipoSolicitud"]:checked').value,
          motivoReemplazo: motivo.value || undefined,
          solicitanteNombre: nombre.value || undefined,
          solicitanteCorreo: correo.value || undefined,
          servicios: servicios,
          sitioWeb: honeypot.value
        })
      })
        .then(function (response) { return response.json(); })
        .then(function (result) {
          submit.disabled = false;
          submit.textContent = 'Enviar solicitud';
          if (result && result.ok) {
            renderMessage(result.message || 'Solicitud registrada.', 'success');
            // Una solicitud nueva (no un reintento) usa un SubmissionId nuevo.
            submissionId = crypto.randomUUID();
          } else {
            renderMessage((result && result.message) || 'No fue posible registrar la solicitud. Intenta de nuevo.', 'error');
          }
        })
        .catch(function () {
          submit.disabled = false;
          submit.textContent = 'Enviar solicitud';
          renderMessage('Sin conexión. Puedes reintentar — no se duplicará si el envío anterior sí llegó.', 'error');
        });
    });

    app.appendChild(form);
  }

  function init() {
    var token = extractToken();
    if (!token) { renderInvalid(); return; }

    fetch('/api/channel/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (!data || !data.ok) { renderInvalid(); return; }
        renderForm(data, token);
      })
      .catch(function () { renderInvalid(); });
  }

  init();
})();
