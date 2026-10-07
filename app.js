(function () {
  'use strict';

  var app = document.getElementById('app');
  var submissionId = null;

  // Logo oficial: archivo estático propio (assets/logo-inka-coya.png), no incrustado.

  var STATUS_META = {
    'oficial-cliente': { color: 'verde', label: 'Oficial' },
    'oficial-automatica': {
      color: 'azul',
      label: 'Automática · no hubo solicitud',
      explicacion: 'No se recibió una nueva solicitud dentro del plazo, así que se mantuvo la última cantidad oficial. Esta cantidad será considerada para producción y EDP.'
    },
    'extraordinaria-pendiente': { color: 'naranjo', label: 'Pendiente de aprobación' },
    'reemplazada': { color: 'gris', label: 'Historial · reemplazada' },
    'no-aceptada': { color: 'rojo', label: 'No aceptada' }
  };

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

  // sessionStorage (no localStorage): se borra sola al cerrar la pestaña — "sesión temporal" real.
  function sessionKey(token) { return 'ich-portal-session:' + token; }
  function getStoredSession(token) {
    try { return sessionStorage.getItem(sessionKey(token)) || null; } catch { return null; }
  }
  function setStoredSession(token, sessionToken) {
    try { sessionStorage.setItem(sessionKey(token), sessionToken); } catch { /* almacenamiento no disponible: solo se pedirá PIN de nuevo si hace falta */ }
  }
  function clearStoredSession(token) {
    try { sessionStorage.removeItem(sessionKey(token)); } catch { /* nada que limpiar */ }
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
    app.appendChild(el('p', { class: 'subtitle', text: 'Este enlace no está disponible. Pide uno nuevo a Inka Coya.' }));
  }

  function tomorrowIso() {
    var d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  // Mismo criterio que api/shared/serviceCatalog.js#isColacion — duplicado a propósito: este
  // archivo corre en el navegador, sin acceso a los módulos de la API.
  function isColacion(tipoServicio) {
    return typeof tipoServicio === 'string' && tipoServicio.indexOf('Colación') === 0;
  }

  var MIN_COLACION_BLOQUES = 4;

  function renderHeader(container, data) {
    var header = el('header', { class: 'brand-header' });
    var logo = el('img', { class: 'brand-logo', src: 'assets/logo-inka-coya.png', alt: 'Inka Coya Hotelería' });
    var titleBlock = el('div', {});
    titleBlock.appendChild(el('h1', { text: 'Solicitud diaria · ' + (data.clienteNombre || '') }));
    if (data.modalidad) titleBlock.appendChild(el('p', { class: 'modalidad', text: data.modalidad }));
    header.appendChild(logo);
    header.appendChild(titleBlock);
    container.appendChild(header);
  }

  // ---------- Paso 1: identificar el enlace y, si corresponde, pedir PIN ----------

  function renderPinScreen(data, token) {
    app.innerHTML = '';
    renderHeader(app, data);

    var body = el('div', { class: 'form-body' });
    body.appendChild(el('p', { class: 'subtitle', text: 'Este enlace pide un PIN adicional antes de continuar.' }));

    var form = el('form', {});
    form.appendChild(el('label', { text: 'PIN', for: 'pin' }));
    var pin = el('input', {
      type: 'password', inputmode: 'numeric', pattern: '[0-9]*', id: 'pin', name: 'pin',
      maxlength: '6', autocomplete: 'off', required: 'required'
    });
    form.appendChild(pin);

    var submit = el('button', { type: 'submit', text: 'Continuar' });
    form.appendChild(submit);

    var messageBox = el('div', { id: 'pin-message-box', class: 'message', hidden: 'hidden' });
    form.appendChild(messageBox);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Verificando…';
      fetch('/api/portal/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, pin: pin.value.trim() })
      })
        .then(function (response) { return response.json(); })
        .then(function (result) {
          submit.disabled = false;
          submit.textContent = 'Continuar';
          if (result && result.ok && result.sessionToken) {
            setStoredSession(token, result.sessionToken);
            renderPortal(data, token, result.sessionToken);
          } else {
            pin.value = '';
            renderMessage(messageBox, (result && result.message) || 'PIN incorrecto.', 'error');
          }
        })
        .catch(function () {
          submit.disabled = false;
          submit.textContent = 'Continuar';
          renderMessage(messageBox, 'Sin conexión. Intenta de nuevo.', 'error');
        });
    });

    body.appendChild(form);
    app.appendChild(body);
    pin.focus();
  }

  // ---------- Portal: encabezado + pestañas ----------

  function renderPortal(data, token, sessionToken) {
    app.innerHTML = '';
    renderHeader(app, data);

    var tabs = el('div', { class: 'portal-tabs' });
    var tabNueva = el('button', { type: 'button', class: 'portal-tab portal-tab-active', text: 'Nueva solicitud' });
    var tabMias = el('button', { type: 'button', class: 'portal-tab', text: 'Mis solicitudes' });
    tabs.appendChild(tabNueva);
    tabs.appendChild(tabMias);
    app.appendChild(tabs);

    var panelNueva = el('div', { class: 'portal-panel' });
    var panelMias = el('div', { class: 'portal-panel', hidden: 'hidden' });
    app.appendChild(panelNueva);
    app.appendChild(panelMias);

    var misSolicitudesLoaded = false;

    function activar(tab) {
      tabNueva.className = 'portal-tab' + (tab === 'nueva' ? ' portal-tab-active' : '');
      tabMias.className = 'portal-tab' + (tab === 'mias' ? ' portal-tab-active' : '');
      panelNueva.hidden = tab !== 'nueva';
      panelMias.hidden = tab !== 'mias';
      if (tab === 'mias' && !misSolicitudesLoaded) {
        misSolicitudesLoaded = true;
        renderMisSolicitudes(panelMias, data, token, sessionToken, irAReemplazar);
      }
    }

    function irAReemplazar(prefill) {
      panelNueva.innerHTML = '';
      renderNuevaSolicitud(panelNueva, data, token, sessionToken, prefill);
      activar('nueva');
    }

    tabNueva.addEventListener('click', function () { activar('nueva'); });
    tabMias.addEventListener('click', function () { activar('mias'); });

    renderNuevaSolicitud(panelNueva, data, token, sessionToken, null);
    activar('nueva');
  }

  // ---------- Sección 1: Nueva solicitud ----------

  function renderNuevaSolicitud(container, data, token, sessionToken, prefill) {
    submissionId = crypto.randomUUID();
    container.innerHTML = '';

    var horaCierre = data.horaCierre || '18:00';
    var condiciones = el('p', {
      class: 'conditions',
      text: 'Envía o modifica hasta las ' + horaCierre + ' del día anterior al servicio. Fuera de ese plazo, tu solicitud queda registrada como extraordinaria pendiente de aceptación interna. Si no llega una solicitud válida antes del plazo, se aplica la proyección automática con la última cantidad oficial confirmada.'
    });
    container.appendChild(condiciones);

    var formBody = el('div', { class: 'form-body' });
    var form = el('form', {});

    var fechaLabel = el('label', { text: 'Fecha del servicio', for: 'fecha' });
    var fecha = el('input', { type: 'date', id: 'fecha', name: 'fecha', value: (prefill && prefill.fecha) || tomorrowIso(), required: 'required' });
    form.appendChild(fechaLabel);
    form.appendChild(fecha);

    var tipoLabel = el('label', { text: 'Tipo de envío' });
    var radioRow = el('div', { class: 'radio-row' });
    var prefillTipo = (prefill && prefill.tipoSolicitud) || 'Solicitud diaria';
    ['Solicitud diaria', 'Reemplazo'].forEach(function (value, index) {
      var id = 'tipo-' + index;
      var input = el('input', { type: 'radio', name: 'tipoSolicitud', id: id, value: value });
      if (value === prefillTipo) input.checked = true;
      var label = el('label', { for: id }, [input, document.createTextNode(value)]);
      radioRow.appendChild(label);
    });
    form.appendChild(tipoLabel);
    form.appendChild(radioRow);

    var motivoLabel = el('label', { text: 'Motivo del reemplazo', id: 'motivo-label' });
    var motivo = el('textarea', { name: 'motivoReemplazo', id: 'motivo' });
    var isReemplazoInicial = prefillTipo === 'Reemplazo';
    motivoLabel.hidden = !isReemplazoInicial;
    motivo.hidden = !isReemplazoInicial;
    if (isReemplazoInicial) motivo.setAttribute('required', 'required');
    form.appendChild(motivoLabel);
    form.appendChild(motivo);
    radioRow.addEventListener('change', function () {
      var isReemplazo = form.querySelector('input[name="tipoSolicitud"]:checked').value === 'Reemplazo';
      motivoLabel.hidden = !isReemplazo;
      motivo.hidden = !isReemplazo;
      // El motivo es obligatorio solo cuando el envío es un reemplazo — nunca en una solicitud inicial.
      if (isReemplazo) motivo.setAttribute('required', 'required');
      else motivo.removeAttribute('required');
    });

    // Colación llega repartida en varios bloques por horario (ver renderColacionBlocks) — el
    // resto de los servicios sigue siendo una sola cantidad por día, como siempre.
    function renderColacionBlocks(servicio) {
      var wrap = el('div', { class: 'colacion-group' });
      wrap.appendChild(el('p', { class: 'colacion-title', text: servicio }));
      var blocksContainer = el('div', { class: 'colacion-blocks' });
      wrap.appendChild(blocksContainer);
      var blocks = [];

      function addBlock(prefillBlock) {
        var row = el('div', { class: 'colacion-block' });
        var horaInput = el('input', { type: 'time', class: 'colacion-hora', 'aria-label': 'Hora — ' + servicio });
        var cantidadInput = el('input', { type: 'number', min: '0', step: '1', class: 'colacion-cantidad', 'aria-label': 'Cantidad — ' + servicio, value: '0' });
        var obsInput = el('input', { type: 'text', class: 'colacion-obs', 'aria-label': 'Observación — ' + servicio, placeholder: 'Observación (opcional)' });
        if (prefillBlock) {
          if (prefillBlock.horario) horaInput.value = prefillBlock.horario;
          if (prefillBlock.cantidad) cantidadInput.value = String(prefillBlock.cantidad);
          if (prefillBlock.observacion) obsInput.value = prefillBlock.observacion;
        }
        row.appendChild(horaInput);
        row.appendChild(cantidadInput);
        row.appendChild(obsInput);
        blocksContainer.appendChild(row);
        blocks.push({ hora: horaInput, cantidad: cantidadInput, observacion: obsInput });
      }

      var prefillBlocks = (prefill && prefill.servicios && prefill.servicios[servicio]) || [];
      var initialCount = Math.max(MIN_COLACION_BLOQUES, prefillBlocks.length);
      for (var i = 0; i < initialCount; i += 1) addBlock(prefillBlocks[i]);

      var addButton = el('button', { type: 'button', class: 'secondary-button colacion-add', text: '+ Agregar horario' });
      addButton.addEventListener('click', function () { addBlock(); });
      wrap.appendChild(addButton);

      form.appendChild(wrap);
      return blocks;
    }

    var serviceInputs = {};
    var colacionBlocksByServicio = {};
    (data.servicios || []).forEach(function (servicio) {
      if (isColacion(servicio)) {
        colacionBlocksByServicio[servicio] = renderColacionBlocks(servicio);
        return;
      }
      var id = 'servicio-' + servicio.replace(/\s+/g, '-');
      var label = el('label', { text: servicio, for: id });
      var prefillEntry = prefill && prefill.servicios && prefill.servicios[servicio] && prefill.servicios[servicio][0];
      var precargada = prefillEntry ? String(prefillEntry.cantidad) : '0';
      var input = el('input', { type: 'number', min: '0', step: '1', id: id, name: id, value: precargada });
      var obsInput = el('input', {
        type: 'text',
        class: 'service-observation',
        'aria-label': 'Observación — ' + servicio,
        placeholder: 'Observación para ' + servicio + ' (opcional)'
      });
      if (prefillEntry && prefillEntry.observacion) obsInput.value = prefillEntry.observacion;
      serviceInputs[servicio] = { cantidad: input, observacion: obsInput };
      form.appendChild(label);
      form.appendChild(input);
      form.appendChild(obsInput);
    });

    form.appendChild(el('label', { text: 'Nombre de quien solicita', for: 'nombre' }));
    var nombre = el('input', { type: 'text', id: 'nombre', name: 'nombre', required: 'required' });
    if (prefill && prefill.solicitanteNombre) nombre.value = prefill.solicitanteNombre;
    form.appendChild(nombre);

    form.appendChild(el('label', { text: 'Correo de quien solicita', for: 'correo' }));
    var correo = el('input', { type: 'email', id: 'correo', name: 'correo', required: 'required' });
    if (prefill && prefill.solicitanteCorreo) correo.value = prefill.solicitanteCorreo;
    form.appendChild(correo);

    // Honeypot: un visitante real nunca ve ni llena este campo.
    var honeypot = el('input', { type: 'text', name: 'sitioWeb', class: 'honeypot', tabindex: '-1', autocomplete: 'off' });
    form.appendChild(honeypot);

    var submit = el('button', { type: 'submit', text: 'Enviar solicitud' });
    form.appendChild(submit);

    var messageBox = el('div', { id: 'message-box', class: 'message', hidden: 'hidden' });
    form.appendChild(messageBox);

    if (prefill) {
      renderMessage(messageBox, 'Datos precargados de tu solicitud anterior para ese día. Indica el motivo del reemplazo antes de enviar.', 'success');
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var servicios = Object.keys(serviceInputs)
        .map(function (name) {
          return {
            tipoServicio: name,
            cantidad: Number(serviceInputs[name].cantidad.value || 0),
            observacion: serviceInputs[name].observacion.value.trim() || undefined
          };
        })
        .filter(function (item) { return item.cantidad > 0; });

      var colacionSinHora = null;
      Object.keys(colacionBlocksByServicio).forEach(function (servicio) {
        colacionBlocksByServicio[servicio].forEach(function (block) {
          var cantidad = Number(block.cantidad.value || 0);
          if (cantidad <= 0) return;
          var horario = block.hora.value.trim();
          if (!horario) { colacionSinHora = servicio; return; }
          servicios.push({
            tipoServicio: servicio,
            cantidad: cantidad,
            horario: horario,
            observacion: block.observacion.value.trim() || undefined
          });
        });
      });

      if (colacionSinHora) {
        renderMessage(messageBox, 'Indica la hora en cada bloque de ' + colacionSinHora + ' que tenga cantidad mayor a cero.', 'error');
        return;
      }

      if (servicios.length === 0) {
        renderMessage(messageBox, 'Ingresa al menos una cantidad mayor a cero.', 'error');
        return;
      }

      if (!nombre.value.trim() || !correo.value.trim()) {
        renderMessage(messageBox, 'Ingresa tu nombre y correo.', 'error');
        return;
      }

      var tipoSolicitudValue = form.querySelector('input[name="tipoSolicitud"]:checked').value;
      if (tipoSolicitudValue === 'Reemplazo' && !motivo.value.trim()) {
        renderMessage(messageBox, 'Indica el motivo del reemplazo.', 'error');
        return;
      }

      submit.disabled = true;
      submit.textContent = 'Enviando…';

      fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token,
          sessionToken: sessionToken || undefined,
          submissionId: submissionId,
          fechaServicio: fecha.value,
          tipoSolicitud: tipoSolicitudValue,
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
            var sentServices = {};
            servicios.forEach(function (item) {
              if (!sentServices[item.tipoServicio]) sentServices[item.tipoServicio] = [];
              sentServices[item.tipoServicio].push({
                cantidad: item.cantidad,
                horario: item.horario,
                observacion: item.observacion
              });
            });
            var receipt = el('section', { class: 'submission-receipt', role: 'status', 'aria-live': 'polite' });
            receipt.appendChild(el('div', { class: 'submission-receipt-icon', text: '✓' }));
            receipt.appendChild(el('h2', { text: 'Solicitud guardada correctamente' }));
            receipt.appendChild(el('p', {
              class: 'subtitle',
              text: result.message || 'La solicitud quedó registrada en Inka Coya.'
            }));
            receipt.appendChild(el('p', {
              class: 'submission-receipt-summary',
              text: fecha.value + ' · ' + servicios.length + (servicios.length === 1 ? ' servicio enviado' : ' servicios enviados')
            }));
            var correct = el('button', { type: 'button', text: 'Corregir esta solicitud' });
            correct.addEventListener('click', function () {
              renderNuevaSolicitud(container, data, token, sessionToken, {
                fecha: fecha.value,
                tipoSolicitud: 'Reemplazo',
                servicios: sentServices,
                solicitanteNombre: nombre.value,
                solicitanteCorreo: correo.value
              });
            });
            receipt.appendChild(correct);
            var another = el('button', { type: 'button', class: 'secondary-button', text: 'Enviar otra solicitud' });
            another.addEventListener('click', function () {
              renderNuevaSolicitud(container, data, token, sessionToken, null);
            });
            receipt.appendChild(another);
            container.innerHTML = '';
            container.appendChild(receipt);
            receipt.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } else if (result && /sesión/i.test(result.message || '')) {
            // La sesión expiró entre medio: se pide el PIN de nuevo, sin perder lo escrito.
            clearStoredSession(token);
            renderMessage(messageBox, result.message, 'error');
          } else {
            renderMessage(messageBox, (result && result.message) || 'No fue posible registrar la solicitud. Intenta de nuevo.', 'error');
          }
        })
        .catch(function () {
          submit.disabled = false;
          submit.textContent = 'Enviar solicitud';
          renderMessage(messageBox, 'Sin conexión. Puedes reintentar — no se duplicará si el envío anterior sí llegó.', 'error');
        });
    });

    formBody.appendChild(form);
    container.appendChild(formBody);
  }

  // ---------- Sección 2: Mis solicitudes ----------

  function formatFechaHora(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      return d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  }

  function renderMisSolicitudes(container, data, token, sessionToken, onReemplazar) {
    container.innerHTML = '';
    var messageBox = el('div', { class: 'message', hidden: 'hidden' });
    var listWrap = el('div', { class: 'mis-solicitudes-list' });
    listWrap.appendChild(el('p', { class: 'subtitle', text: 'Cargando…' }));
    container.appendChild(messageBox);
    container.appendChild(listWrap);

    fetch('/api/portal/mis-solicitudes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, sessionToken: sessionToken || '' })
    })
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (!result || !result.ok) {
          listWrap.innerHTML = '';
          if (result && /sesión/i.test(result.message || '')) clearStoredSession(token);
          renderMessage(messageBox, (result && result.message) || 'No fue posible cargar tus solicitudes.', 'error');
          return;
        }
        renderLista(result.solicitudes || []);
      })
      .catch(function () {
        listWrap.innerHTML = '';
        renderMessage(messageBox, 'Sin conexión. Intenta de nuevo.', 'error');
      });

    function renderLista(solicitudes) {
      listWrap.innerHTML = '';
      if (solicitudes.length === 0) {
        listWrap.appendChild(el('p', { class: 'subtitle', text: 'No hay solicitudes en los últimos 30 días.' }));
        return;
      }

      // Se agrupan por fecha para que "Reemplazar" precargue todos los servicios vigentes de ese día.
      var porFecha = {};
      var ordenFechas = [];
      solicitudes.forEach(function (s) {
        if (!porFecha[s.fecha]) { porFecha[s.fecha] = []; ordenFechas.push(s.fecha); }
        porFecha[s.fecha].push(s);
      });

      ordenFechas.forEach(function (fecha) {
        var grupo = porFecha[fecha];
        var card = el('div', { class: 'solicitud-card' });
        card.appendChild(el('h3', { text: 'Día ' + fecha }));

        var vigentes = grupo.filter(function (s) { return s.estado !== 'reemplazada' && s.estado !== 'no-aceptada'; });
        var historicas = grupo.filter(function (s) { return s.estado === 'reemplazada' || s.estado === 'no-aceptada'; });

        function buildTable(rows) {
          var wrap = el('div', { class: 'portal-table-wrap' });
          var table = el('table', { class: 'portal-table' });
          var thead = el('thead', {});
          var header = el('tr', {});
          ['Servicio', 'Cantidad oficial', 'Observación', 'Estado'].forEach(function (label) {
            header.appendChild(el('th', { text: label }));
          });
          thead.appendChild(header);
          table.appendChild(thead);
          var tbody = el('tbody', {});
          rows.forEach(function (s) {
            var meta = STATUS_META[s.estado] || { color: 'gris', label: s.estado };
            var row = el('tr', {});
            row.appendChild(el('td', { text: s.tipoServicio + (s.horario ? ' · ' + s.horario : '') }));
            row.appendChild(el('td', { text: String(s.cantidad) }));
            row.appendChild(el('td', { text: s.observacion || '—' }));
            var statusCell = el('td', {});
            statusCell.appendChild(el('span', { class: 'status-label status-' + meta.color, text: meta.label }));
            row.appendChild(statusCell);
            tbody.appendChild(row);
          });
          table.appendChild(tbody);
          wrap.appendChild(table);
          return wrap;
        }

        if (vigentes.length > 0) card.appendChild(buildTable(vigentes));

        var vigentesParaReemplazo = {};
        vigentes.forEach(function (s) {
          if (s.estado !== 'reemplazada' && s.estado !== 'no-aceptada') {
            if (!vigentesParaReemplazo[s.tipoServicio]) vigentesParaReemplazo[s.tipoServicio] = [];
            vigentesParaReemplazo[s.tipoServicio].push({ cantidad: s.cantidad, horario: s.horario, observacion: s.observacion });
          }
        });

        var newest = grupo[0];
        if (newest) {
          var parts = [];
          if (newest.remitente) parts.push('Enviado por ' + newest.remitente);
          if (newest.horaEnvio) parts.push(formatFechaHora(newest.horaEnvio));
          if (newest.tipoSolicitud === 'Reemplazo' && newest.motivoReemplazo) parts.push('Motivo: ' + newest.motivoReemplazo);
          if (parts.length > 0) card.appendChild(el('p', { class: 'solicitud-detalle', text: parts.join(' · ') }));
        }

        if (historicas.length > 0) {
          var history = el('details', { class: 'solicitud-history' });
          history.appendChild(el('summary', { text: 'Ver historial anterior (' + historicas.length + ')' }));
          history.appendChild(buildTable(historicas));
          card.appendChild(history);
        }

        if (Object.keys(vigentesParaReemplazo).length > 0) {
          var btn = el('button', { type: 'button', class: 'secondary-button', text: 'Reemplazar solicitud' });
          btn.addEventListener('click', function () {
            onReemplazar({ fecha: fecha, tipoSolicitud: 'Reemplazo', servicios: vigentesParaReemplazo });
          });
          card.appendChild(btn);
        }

        listWrap.appendChild(card);
      });
    }
  }

  // ---------- Arranque ----------

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
        if (data.requierePin) {
          var existing = getStoredSession(token);
          if (existing) {
            // Sesión de una visita anterior en esta misma pestaña: se intenta usar directo;
            // si ya expiró, las llamadas a la API lo dirán y se limpia sola.
            renderPortal(data, token, existing);
          } else {
            renderPinScreen(data, token);
          }
        } else {
          renderPortal(data, token, null);
        }
      })
      .catch(function () { renderInvalid(); });
  }

  init();
})();
