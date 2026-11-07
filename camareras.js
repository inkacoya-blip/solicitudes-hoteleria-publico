(function () {
  'use strict';

  /**
   * App del celular de hospedaje: camareras, supervisoras y recepción.
   * - Entra con código personal + PIN (nunca con un enlace compartido): así queda registrado quién hizo cada cosa.
   * - El QR de una casa o de una pieza solo trae «#/c/<casa>[/<pieza>]»: no es un secreto, sin el PIN no abre nada.
   * - El navegador solo muestra y manda datos; todas las reglas se vuelven a validar en el servidor (/api/hk/*).
   */
  var app = document.getElementById('app');
  var STORE_KEY = 'hkSession';
  var MAX_DIMENSION = 1600;
  var JPEG_QUALITY = 0.7;

  var state = {
    session: null,
    persona: null,
    casas: [],
    casaId: null,
    fecha: null,
    house: null,
    openRoom: null,
    draft: null,
    target: parseTarget(),
    bpmTarget: parseBpmTarget(),
    bpm: null,
    bpmFecha: null,
    notice: null
  };

  function parseTarget() {
    var match = /^#\/c\/(\d+)(?:\/([^/]+))?$/.exec(window.location.hash || '');
    return match ? { casaId: Number(match[1]), pieza: match[2] ? decodeURIComponent(match[2]) : null } : null;
  }

  /** El QR de una hoja BPM trae «#/bpm/<código del formato>»; «#/bpm» a secas abre la lista. */
  function parseBpmTarget() {
    var match = /^#\/bpm(?:\/([A-Za-z0-9-]+))?$/.exec(window.location.hash || '');
    return match ? { codigo: match[1] || null } : null;
  }

  function loadStoredSession() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && typeof data.token === 'string' && data.persona) {
        state.session = data.token;
        state.persona = data.persona;
      }
    } catch (error) { /* sin almacenamiento: se pide el PIN cada vez */ }
  }

  function storeSession() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify({ token: state.session, persona: state.persona })); } catch (error) { /* ignorar */ }
  }

  function clearSession() {
    state.session = null;
    state.persona = null;
    state.house = null;
    state.casaId = null;
    state.openRoom = null;
    state.draft = null;
    try { window.localStorage.removeItem(STORE_KEY); } catch (error) { /* ignorar */ }
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key.indexOf('on') === 0 && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  function newSubmissionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'sub-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function api(action, body) {
    var payload = {};
    Object.keys(body || {}).forEach(function (key) { payload[key] = body[key]; });
    if (state.session) payload.sessionToken = state.session;
    return fetch('/api/hk/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (response) { return response.json(); }).then(function (data) {
      if (data && data.sessionExpired) {
        clearSession();
        state.notice = { type: 'error', text: data.message };
        renderLogin();
        throw new Error('sesion');
      }
      return data;
    });
  }

  function failMessage(error) {
    if (error && error.message === 'sesion') return;
    showNotice('error', 'No hay conexión o falló el envío. Revisa la señal e inténtalo de nuevo.');
  }

  function showNotice(type, text) {
    state.notice = { type: type, text: text };
    var box = document.getElementById('hk-notice');
    if (box) { paintNotice(box); state.notice = null; }
    window.scrollTo(0, 0);
  }

  function paintNotice(box) {
    if (!state.notice) { box.hidden = true; return; }
    box.textContent = state.notice.text;
    box.className = 'message ' + state.notice.type;
    box.hidden = false;
  }

  /** El aviso se muestra una sola vez: al volver a dibujar la pantalla ya no aparece. */
  function noticeBox() {
    var box = el('div', { id: 'hk-notice', class: 'message', hidden: true });
    paintNotice(box);
    state.notice = null;
    return box;
  }

  function clearScreen() {
    app.innerHTML = '';
  }

  /* ---------- Entrada ---------- */

  function renderLogin() {
    clearScreen();
    var codeInput = el('input', { type: 'text', id: 'codigo', autocomplete: 'username', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', placeholder: 'CAM-001', maxlength: '12' });
    var pinInput = el('input', { type: 'password', id: 'pin', autocomplete: 'current-password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '6', placeholder: '6 dígitos' });
    var button = el('button', { type: 'button', text: 'Entrar' });
    var form = el('div', { class: 'form-body' }, [
      el('h1', { text: 'Parte diario' }),
      el('p', { class: 'subtitle', text: 'Inka Coya Hotelería. Entra con tu código y tu PIN personal.' }),
      noticeBox(),
      el('label', { for: 'codigo', text: 'Tu código' }),
      codeInput,
      el('label', { for: 'pin', text: 'Tu PIN' }),
      pinInput,
      button
    ]);
    app.appendChild(form);

    function submit() {
      var codigo = codeInput.value.trim();
      var pin = pinInput.value.trim();
      if (!codigo || !/^\d{6}$/.test(pin)) {
        showNotice('error', 'Escribe tu código y tu PIN de 6 dígitos.');
        return;
      }
      button.disabled = true;
      button.textContent = 'Entrando…';
      api('login', { codigo: codigo, pin: pin }).then(function (data) {
        if (!data.ok) {
          pinInput.value = '';
          showNotice('error', data.message || 'No fue posible entrar.');
          return;
        }
        state.session = data.sessionToken;
        state.persona = data.persona;
        state.notice = null;
        storeSession();
        return start();
      }).catch(failMessage).then(function () {
        button.disabled = false;
        button.textContent = 'Entrar';
      });
    }
    button.addEventListener('click', submit);
    pinInput.addEventListener('keydown', function (event) { if (event.key === 'Enter') submit(); });
  }

  function topBar(backAction, backLabel) {
    var left = backAction
      ? el('button', { type: 'button', class: 'hk-link', text: backLabel || '‹ Casas', onclick: backAction })
      : el('span', { class: 'hk-who', text: state.persona.nombre + ' · ' + state.persona.rol });
    return el('div', { class: 'hk-top' }, [
      left,
      el('button', { type: 'button', class: 'hk-link', text: 'Salir', onclick: function () { clearSession(); state.notice = null; renderLogin(); } })
    ]);
  }

  function start() {
    return api('houses').then(function (data) {
      if (!data.ok) { showNotice('error', data.message || 'No fue posible cargar las casas.'); return; }
      state.casas = data.casas;
      if (state.bpmTarget) {
        var wantedBpm = state.bpmTarget;
        state.bpmTarget = null;
        if (state.persona.supervision) return openBpm(null, wantedBpm.codigo);
        state.notice = { type: 'error', text: 'Los registros BPM los sube la supervisora.' };
      }
      // Con el QR de una casa se abre esa casa; si el personal solo tiene una, también; si no, elige.
      var wanted = state.target && state.casas.some(function (casa) { return casa.id === state.target.casaId; }) ? state.target.casaId : null;
      if (!wanted && state.casas.length === 1) wanted = state.casas[0].id;
      if (wanted) return openHouse(wanted, null);
      renderHouses();
    }).catch(failMessage);
  }

  function renderHouses() {
    clearScreen();
    app.appendChild(topBar(null));
    var body = el('div', { class: 'form-body' }, [
      el('h1', { text: '¿En qué casa estás?' }),
      el('p', { class: 'subtitle', text: 'Elige la casa para ver sus piezas.' }),
      noticeBox()
    ]);
    state.casas.forEach(function (casa) {
      body.appendChild(el('button', { type: 'button', class: 'hk-big', text: casa.nombre, onclick: function () { openHouse(casa.id, null); } }));
    });
    if (state.persona.supervision) body.appendChild(el('button', { type: 'button', class: 'hk-secondary', text: 'Registros BPM (temperaturas, higiene, limpieza)', onclick: function () { openBpm(null, null); } }));
    app.appendChild(body);
  }

  /* ---------- Casa ---------- */

  function openHouse(casaId, fecha) {
    state.casaId = casaId;
    state.fecha = fecha;
    state.openRoom = null;
    state.draft = null;
    return loadHouse();
  }

  function loadHouse() {
    return api('house', { casaId: state.casaId, fecha: state.fecha || undefined }).then(function (data) {
      if (!data.ok) { showNotice('error', data.message || 'No fue posible cargar la casa.'); if (!state.house) renderHouses(); return; }
      state.house = data;
      state.fecha = data.fecha;
      if (state.target && state.target.casaId === data.casa.id && state.target.pieza) {
        var piece = data.piezas.filter(function (item) { return item.numero === state.target.pieza; })[0];
        if (piece) { state.openRoom = piece.id; state.draft = draftFor(piece); }
        state.target.pieza = null;
      }
      renderHouse();
      if (state.openRoom) {
        var open = document.getElementById('hk-room-' + state.openRoom);
        if (open && open.scrollIntoView) open.scrollIntoView({ block: 'start' });
      }
    }).catch(failMessage);
  }

  function contractLabel(house, contractId) {
    var found = house.contratos.filter(function (item) { return item.id === contractId; })[0];
    if (!found) return contractId ? 'Contrato ' + contractId : '';
    var repeated = house.contratos.filter(function (item) { return item.empresa === found.empresa; }).length > 1;
    return repeated ? found.empresa + ' (' + found.referencia + ')' : found.empresa;
  }

  function draftFor(room) {
    var house = state.house;
    if (room.parte) {
      return {
        ocupacion: room.parte.ocupacion, contratoId: room.parte.contratoId, personas: room.parte.personas, camas: room.parte.camas,
        limpiezaDiaria: room.parte.limpiezaDiaria, cambioSabanas: room.parte.cambioSabanas, aseoFondo: room.parte.aseoFondo,
        sinDanos: room.parte.sinDanos, observacion: room.parte.observacion
      };
    }
    var suggestion = room.sugerido;
    var singleContract = house.contratos.length === 1 ? house.contratos[0].id : null;
    var bedsDefault = room.camas > 0 ? room.camas : 1;
    return {
      ocupacion: suggestion ? suggestion.ocupacion : '',
      contratoId: suggestion && suggestion.contratoId ? suggestion.contratoId : singleContract,
      personas: suggestion && suggestion.personas ? suggestion.personas : bedsDefault,
      camas: suggestion && suggestion.camas ? suggestion.camas : bedsDefault,
      limpiezaDiaria: false, cambioSabanas: false, aseoFondo: false, sinDanos: false, observacion: ''
    };
  }

  function dateLabel(iso) {
    var parts = iso.split('-');
    return parts[2] + '-' + parts[1] + '-' + parts[0];
  }

  function renderHouse() {
    var house = state.house;
    var isSupervision = state.persona.supervision;
    clearScreen();
    app.appendChild(topBar(state.casas.length > 1 ? function () { state.house = null; renderHouses(); } : null));

    var registered = house.piezas.filter(function (room) { return room.parte; }).length;
    var body = el('div', { class: 'form-body' }, [
      el('h1', { text: house.casa.nombre }),
      el('p', { class: 'subtitle', text: state.persona.nombre + ' · ' + state.persona.rol + ' · ' + dateLabel(house.fecha) })
    ]);
    body.appendChild(noticeBox());

    // Fecha: hoy / ayer para el personal; cualquier día de las últimas dos semanas para la supervisora.
    var dateRow = el('div', { class: 'hk-row' });
    if (isSupervision) {
      var picker = el('input', { type: 'date', value: house.fecha, max: house.hoy });
      picker.addEventListener('change', function () { if (picker.value) { state.notice = null; openHouse(house.casa.id, picker.value); } });
      dateRow.appendChild(picker);
    } else {
      var yesterday = addDaysIso(house.hoy, -1);
      dateRow.appendChild(el('button', { type: 'button', class: 'hk-chip' + (house.fecha === house.hoy ? ' hk-chip-on' : ''), text: 'Hoy', onclick: function () { state.notice = null; openHouse(house.casa.id, house.hoy); } }));
      dateRow.appendChild(el('button', { type: 'button', class: 'hk-chip' + (house.fecha === yesterday ? ' hk-chip-on' : ''), text: 'Ayer', onclick: function () { state.notice = null; openHouse(house.casa.id, yesterday); } }));
    }
    body.appendChild(dateRow);

    if (house.cerrado) {
      body.appendChild(el('div', { class: 'message success', text: 'Día cerrado por ' + house.cerrado.por + '. Para corregir algo, la supervisora debe reabrirlo.' }));
    }
    body.appendChild(el('p', { class: 'hk-progress', text: registered + ' de ' + house.piezas.length + ' piezas registradas' }));

    // Confirmar de una vez las piezas que siguen igual que ayer.
    var carry = house.piezas.filter(function (room) { return !room.parte && room.sugerido; });
    if (!house.cerrado && carry.length > 0) {
      body.appendChild(el('button', {
        type: 'button', class: 'hk-secondary', text: carry.length === 1 ? 'Dejar como ayer la pieza sin registrar' : 'Dejar como ayer las ' + carry.length + ' piezas sin registrar',
        onclick: function () { confirmAsYesterday(carry); }
      }));
      body.appendChild(el('p', { class: 'hk-help', text: 'Copia la ocupación de ayer (empresa y personas). La limpieza la marcas tú en cada pieza.' }));
    }

    var list = el('div', { class: 'hk-rooms' });
    house.piezas.forEach(function (room) { list.appendChild(renderRoom(room)); });
    body.appendChild(list);

    body.appendChild(renderSupplies());
    if (isSupervision) body.appendChild(renderSupervision());
    app.appendChild(body);
  }

  function addDaysIso(iso, days) {
    var parts = iso.split('-').map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
    return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
  }

  function summaryOf(room) {
    var house = state.house;
    if (!room.parte) {
      return room.sugerido ? 'Sin registrar · ayer: ' + (room.sugerido.ocupacion === 'Ocupada' ? 'ocupada' : 'vacía') : 'Sin registrar';
    }
    var parte = room.parte;
    var pieces = [parte.ocupacion];
    if (parte.ocupacion !== 'Vacía') pieces.push(contractLabel(house, parte.contratoId), parte.personas + (parte.personas === 1 ? ' persona' : ' personas'));
    if (parte.limpiezaDiaria) pieces.push('limpia');
    return pieces.filter(Boolean).join(' · ');
  }

  function renderRoom(room) {
    var isOpen = state.openRoom === room.id;
    var card = el('div', { class: 'hk-room' + (room.parte ? ' hk-room-done' : '') + (isOpen ? ' hk-room-open' : ''), id: 'hk-room-' + room.id });
    var head = el('button', {
      type: 'button', class: 'hk-room-head',
      onclick: function () {
        state.openRoom = isOpen ? null : room.id;
        state.draft = isOpen ? null : draftFor(room);
        renderHouse();
        var node = document.getElementById('hk-room-' + room.id);
        if (node && !isOpen && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
      }
    }, [
      el('strong', { class: 'hk-room-number', text: room.numero }),
      el('span', { class: 'hk-room-summary', text: summaryOf(room) })
    ]);
    if (room.muestra) head.appendChild(el('span', { class: 'hk-badge', text: room.parte && room.parte.revision ? room.parte.revision : 'Revisar' }));
    card.appendChild(head);
    if (isOpen) card.appendChild(renderEditor(room));
    return card;
  }

  function stepper(label, value, min, max, onChange) {
    var number = el('span', { class: 'hk-step-value', text: String(value) });
    function set(next) { if (next < min || next > max) return; onChange(next); number.textContent = String(next); value = next; }
    return el('div', { class: 'hk-step' }, [
      el('span', { class: 'hk-step-label', text: label }),
      el('button', { type: 'button', class: 'hk-step-btn', text: '−', onclick: function () { set(value - 1); } }),
      number,
      el('button', { type: 'button', class: 'hk-step-btn', text: '+', onclick: function () { set(value + 1); } })
    ]);
  }

  function checkbox(label, checked, onChange) {
    var input = el('input', { type: 'checkbox', checked: checked ? true : undefined });
    input.addEventListener('change', function () { onChange(input.checked); });
    return el('label', { class: 'hk-check' }, [input, document.createTextNode(' ' + label)]);
  }

  function renderEditor(room) {
    var house = state.house;
    var draft = state.draft;
    var locked = Boolean(house.cerrado);
    var box = el('div', { class: 'hk-editor' });

    var occupancy = el('div', { class: 'hk-seg' });
    ['Ocupada', 'Vacía', 'Sale hoy'].forEach(function (option) {
      occupancy.appendChild(el('button', {
        type: 'button', class: 'hk-seg-btn' + (draft.ocupacion === option ? ' hk-seg-on' : ''), text: option,
        onclick: function () {
          if (locked) return;
          draft.ocupacion = option;
          if (option !== 'Vacía' && !draft.contratoId && house.contratos.length === 1) draft.contratoId = house.contratos[0].id;
          renderHouse();
        }
      }));
    });
    box.appendChild(occupancy);
    box.appendChild(el('p', { class: 'hk-help', text: 'Marca quién durmió anoche en la pieza: «Ocupada» si duerme y sigue, «Sale hoy» si durmió y se va hoy, «Vacía» si nadie durmió.' }));

    if (draft.ocupacion === 'Ocupada' || draft.ocupacion === 'Sale hoy') {
      var select = el('select', { 'aria-label': 'Empresa o contrato' });
      select.appendChild(el('option', { value: '', text: 'Empresa o contrato…' }));
      house.contratos.forEach(function (contract) {
        select.appendChild(el('option', { value: String(contract.id), text: contractLabel(house, contract.id), selected: draft.contratoId === contract.id ? true : undefined }));
      });
      select.addEventListener('change', function () { draft.contratoId = select.value ? Number(select.value) : null; });
      box.appendChild(select);
      box.appendChild(stepper('Personas', draft.personas, 1, 20, function (value) { draft.personas = value; }));
      box.appendChild(stepper('Camas usadas', draft.camas, 1, room.camas > 0 ? room.camas : 20, function (value) { draft.camas = value; }));
    }

    if (draft.ocupacion) {
      box.appendChild(checkbox('Limpieza diaria hecha', draft.limpiezaDiaria, function (value) { draft.limpiezaDiaria = value; }));
      box.appendChild(checkbox('Cambio de sábanas', draft.cambioSabanas, function (value) { draft.cambioSabanas = value; }));
      box.appendChild(checkbox('Aseo a fondo', draft.aseoFondo, function (value) { draft.aseoFondo = value; }));
      box.appendChild(checkbox('Revisé la pieza: sin daños', draft.sinDanos, function (value) { draft.sinDanos = value; }));
      var note = el('textarea', { placeholder: 'Observación (opcional)', maxlength: '500' });
      note.value = draft.observacion || '';
      note.addEventListener('input', function () { draft.observacion = note.value; });
      box.appendChild(note);
    }

    var actions = el('div', { class: 'hk-actions' });
    if (!locked) {
      var save = el('button', { type: 'button', text: room.parte ? 'Guardar cambios' : 'Guardar pieza' });
      save.addEventListener('click', function () { saveRoom(room, save); });
      actions.appendChild(save);
    }
    actions.appendChild(el('button', { type: 'button', class: 'hk-secondary', text: 'Reportar un daño', onclick: function () { openDamageSheet(room); } }));
    actions.appendChild(el('button', { type: 'button', class: 'hk-secondary', text: 'Pedir insumos para esta pieza', onclick: function () { openSupplySheet(room); } }));
    box.appendChild(actions);

    if (state.persona.supervision && room.parte && !locked) box.appendChild(renderReview(room));
    if (room.parte) {
      var info = 'Registró: ' + room.parte.registradoPor + (room.parte.modificadoPor ? ' · Último cambio: ' + room.parte.modificadoPor : '');
      box.appendChild(el('p', { class: 'hk-help', text: info }));
    }
    return box;
  }

  function payloadFromDraft(roomId, draft) {
    return {
      piezaId: roomId, ocupacion: draft.ocupacion, contratoId: draft.ocupacion === 'Vacía' ? null : draft.contratoId,
      personas: draft.personas, camas: draft.camas, limpiezaDiaria: draft.limpiezaDiaria, cambioSabanas: draft.cambioSabanas,
      aseoFondo: draft.aseoFondo, sinDanos: draft.sinDanos, observacion: draft.observacion
    };
  }

  function saveRoom(room, button) {
    var draft = state.draft;
    if (!draft || !draft.ocupacion) { showNotice('error', 'Indica si la pieza está ocupada, vacía o si sale hoy.'); return; }
    button.disabled = true;
    button.textContent = 'Guardando…';
    api('save-rooms', { casaId: state.casaId, fecha: state.fecha, piezas: [payloadFromDraft(room.id, draft)] }).then(function (data) {
      if (!data.ok) {
        var detail = data.errors && data.errors.length ? data.errors[0].message : data.message;
        showNotice('error', detail || 'No fue posible guardar.');
        button.disabled = false;
        button.textContent = 'Guardar pieza';
        return;
      }
      state.openRoom = null;
      state.draft = null;
      state.notice = { type: 'success', text: 'Pieza ' + room.numero + ' guardada.' };
      return loadHouse();
    }).catch(function (error) {
      button.disabled = false;
      button.textContent = 'Guardar pieza';
      failMessage(error);
    });
  }

  function confirmAsYesterday(rooms) {
    var pieces = rooms.map(function (room) {
      var suggestion = room.sugerido;
      return {
        piezaId: room.id, ocupacion: suggestion.ocupacion, contratoId: suggestion.contratoId, personas: suggestion.personas,
        camas: suggestion.camas, limpiezaDiaria: false, cambioSabanas: false, aseoFondo: false, sinDanos: false, observacion: ''
      };
    });
    api('save-rooms', { casaId: state.casaId, fecha: state.fecha, piezas: pieces }).then(function (data) {
      if (data.ok) {
        state.notice = { type: 'success', text: data.saved + ' piezas confirmadas como ayer. Marca la limpieza en cada una.' };
      } else if (data.errors && data.errors.length) {
        var names = data.errors.map(function (item) { return item.numero || item.piezaId; }).join(', ');
        state.notice = { type: 'error', text: 'Se guardaron ' + data.saved + '. No se pudo copiar de ayer: ' + names + '. Revísalas una por una (cambió la empresa o las camas).' };
      } else {
        state.notice = { type: 'error', text: data.message || 'No fue posible guardar.' };
      }
      return loadHouse();
    }).catch(failMessage);
  }

  /* ---------- Revisión (supervisora) ---------- */

  function renderReview(room) {
    var note = el('input', { type: 'text', placeholder: 'Si queda observada: qué falta', maxlength: '500' });
    function send(result) {
      api('review-room', { casaId: state.casaId, fecha: state.fecha, piezaId: room.id, resultado: result, nota: note.value }).then(function (data) {
        if (!data.ok) { showNotice('error', data.message); return; }
        state.notice = { type: 'success', text: 'Revisión de la pieza ' + room.numero + ' guardada.' };
        return loadHouse();
      }).catch(failMessage);
    }
    return el('div', { class: 'hk-review' }, [
      el('strong', { text: 'Revisión de la supervisora' }),
      note,
      el('div', { class: 'hk-row' }, [
        el('button', { type: 'button', class: 'hk-secondary', text: 'Conforme', onclick: function () { send('Conforme'); } }),
        el('button', { type: 'button', class: 'hk-secondary', text: 'Observada', onclick: function () { send('Observada'); } })
      ])
    ]);
  }

  /* ---------- Insumos ---------- */

  function renderSupplies() {
    var house = state.house;
    var section = el('div', { class: 'hk-section' }, [
      el('h2', { text: 'Insumos de la casa' }),
      el('button', { type: 'button', text: 'Pedir insumos a Bodega', onclick: function () { openSupplySheet(null); } })
    ]);
    if (house.pedidos.length > 0) {
      var list = el('ul', { class: 'hk-list' });
      house.pedidos.forEach(function (order) {
        var when = new Date(order.cuando);
        var stamp = isNaN(when.getTime()) ? '' : String(when.getDate()).padStart(2, '0') + '/' + String(when.getMonth() + 1).padStart(2, '0');
        list.appendChild(el('li', null, [
          el('strong', { text: order.estado }),
          document.createTextNode(' · ' + stamp + (order.pieza ? ' · pieza ' + order.pieza : '') + ' · ' + order.por),
          el('div', { class: 'hk-pre', text: order.detalle })
        ]));
      });
      section.appendChild(el('p', { class: 'hk-help', text: 'Pedidos de los últimos 7 días' }));
      section.appendChild(list);
    }
    return section;
  }

  function closeSheet() {
    var sheet = document.getElementById('hk-sheet');
    if (sheet) sheet.remove();
  }

  function openSheet(title, content) {
    closeSheet();
    var sheet = el('div', { id: 'hk-sheet', class: 'hk-sheet' }, [
      el('div', { class: 'hk-sheet-card' }, [
        el('div', { class: 'hk-top' }, [el('h2', { text: title }), el('button', { type: 'button', class: 'hk-link', text: 'Cerrar', onclick: closeSheet })])
      ].concat(content))
    ]);
    // Dentro de #app (clase .hk) para que reciba los mismos estilos de botones que el resto de la pantalla.
    app.appendChild(sheet);
  }

  function openSupplySheet(room) {
    var house = state.house;
    var submissionId = newSubmissionId();
    var quantities = {};
    var rows = house.catalogoInsumos.map(function (name) {
      quantities[name] = 0;
      if (name === 'Otro') return null;
      return stepper(name, 0, 0, 99, function (value) { quantities[name] = value; });
    });
    var otherName = el('input', { type: 'text', placeholder: '¿Qué insumo? (si no está en la lista)', maxlength: '120' });
    var otherQty = 0;
    var pieceSelect = el('select', { 'aria-label': 'Pieza (opcional)' });
    pieceSelect.appendChild(el('option', { value: '', text: 'Para toda la casa (sin pieza)' }));
    house.piezas.forEach(function (item) {
      pieceSelect.appendChild(el('option', { value: String(item.id), text: 'Pieza ' + item.numero, selected: room && room.id === item.id ? true : undefined }));
    });
    var note = el('input', { type: 'text', placeholder: 'Nota para Bodega (opcional)', maxlength: '300' });
    var message = el('div', { class: 'message', hidden: true });
    var send = el('button', { type: 'button', text: 'Enviar pedido a Bodega' });

    send.addEventListener('click', function () {
      var items = [];
      house.catalogoInsumos.forEach(function (name) { if (name !== 'Otro' && quantities[name] > 0) items.push({ articulo: name, cantidad: quantities[name] }); });
      if (otherName.value.trim()) items.push({ articulo: 'Otro', detalle: otherName.value.trim(), cantidad: otherQty || 1 });
      if (items.length === 0) { message.textContent = 'Agrega al menos un insumo.'; message.className = 'message error'; message.hidden = false; return; }
      send.disabled = true;
      send.textContent = 'Enviando…';
      api('request-supplies', { casaId: state.casaId, piezaId: pieceSelect.value ? Number(pieceSelect.value) : undefined, items: items, nota: note.value, submissionId: submissionId }).then(function (data) {
        if (!data.ok) {
          message.textContent = data.message || 'No fue posible enviar el pedido.';
          message.className = 'message error';
          message.hidden = false;
          send.disabled = false;
          send.textContent = 'Enviar pedido a Bodega';
          return;
        }
        closeSheet();
        state.notice = { type: 'success', text: data.message };
        return loadHouse();
      }).catch(function (error) {
        send.disabled = false;
        send.textContent = 'Enviar pedido a Bodega';
        failMessage(error);
      });
    });

    openSheet('Pedir insumos · ' + house.casa.nombre, [
      el('p', { class: 'hk-help', text: 'El pedido queda a nombre tuyo y de esta casa.' }),
      pieceSelect
    ].concat(rows.filter(Boolean)).concat([otherName, stepper('Cantidad de «otro»', 0, 0, 99, function (value) { otherQty = value; }), note, message, send]));
  }

  /* ---------- Daños ---------- */

  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('No se pudo leer la foto.')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('No se pudo procesar la foto.')); };
        img.onload = function () {
          var scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve({ base64: canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1] || '', contentType: 'image/jpeg' });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function openDamageSheet(room) {
    var submissionId = newSubmissionId();
    var type = '';
    var typeRow = el('div', { class: 'hk-seg' });
    var help = el('p', { class: 'hk-help', text: 'Desgaste: se rompió solo por el uso (no se cobra). Posible mal uso: lo dañó el huésped; es obligatorio sacar foto y la supervisora avisa al cliente hoy mismo.' });
    var photoLabel = el('label', { for: 'hk-photo', text: 'Foto' });
    var photo = el('input', { type: 'file', id: 'hk-photo', accept: 'image/*', capture: 'environment' });
    var description = el('textarea', { placeholder: '¿Qué pasó? Describe el daño', maxlength: '1000' });
    var message = el('div', { class: 'message', hidden: true });
    var send = el('button', { type: 'button', text: 'Enviar el daño' });

    ['Desgaste', 'Posible mal uso'].forEach(function (option) {
      typeRow.appendChild(el('button', {
        type: 'button', class: 'hk-seg-btn', text: option,
        onclick: function (event) {
          type = option;
          Array.prototype.forEach.call(typeRow.children, function (child) { child.className = 'hk-seg-btn' + (child === event.currentTarget ? ' hk-seg-on' : ''); });
          photoLabel.textContent = option === 'Posible mal uso' ? 'Foto (obligatoria)' : 'Foto (opcional)';
        }
      }));
    });

    function showError(text) { message.textContent = text; message.className = 'message error'; message.hidden = false; }

    send.addEventListener('click', function () {
      if (!type) return showError('Elige si es desgaste o posible mal uso.');
      if (description.value.trim().length < 5) return showError('Describe el daño con unas palabras.');
      var file = photo.files && photo.files[0];
      if (type === 'Posible mal uso' && !file) return showError('Un posible mal uso necesita una foto.');
      send.disabled = true;
      send.textContent = 'Enviando…';
      (file ? compressImage(file) : Promise.resolve(null)).then(function (image) {
        return api('report-damage', {
          casaId: state.casaId, fecha: state.fecha, piezaId: room.id, tipo: type, descripcion: description.value, submissionId: submissionId,
          fotoBase64: image ? image.base64 : undefined, fotoContentType: image ? image.contentType : undefined
        });
      }).then(function (data) {
        if (!data.ok) { showError(data.message || 'No fue posible registrar el daño.'); send.disabled = false; send.textContent = 'Enviar el daño'; return; }
        closeSheet();
        state.notice = { type: 'success', text: data.message };
        return loadHouse();
      }).catch(function (error) {
        send.disabled = false;
        send.textContent = 'Enviar el daño';
        if (error && error.message === 'sesion') return;
        showError('No se pudo enviar. Revisa la señal e inténtalo de nuevo.');
      });
    });

    openSheet('Daño en la pieza ' + room.numero, [typeRow, help, description, photoLabel, photo, message, send]);
  }

  /* ---------- Supervisión ---------- */

  function renderSupervision() {
    var house = state.house;
    var section = el('div', { class: 'hk-section' }, [el('h2', { text: 'Supervisión' })]);
    section.appendChild(el('button', { type: 'button', class: 'hk-secondary', text: 'Registros BPM (temperaturas, higiene, limpieza)', onclick: function () { openBpm(null, null); } }));

    if (house.danosPorConfirmar.length > 0) {
      section.appendChild(el('p', { class: 'hk-help', text: 'Posibles malos usos por confirmar. Si lo confirmas, avisa al cliente hoy mismo.' }));
      house.danosPorConfirmar.forEach(function (damage) {
        var note = el('input', { type: 'text', placeholder: 'Nota (ej. a quién se avisó)', maxlength: '500' });
        function decide(decision) {
          api('decide-damage', { incidenteId: damage.id, decision: decision, nota: note.value }).then(function (data) {
            state.notice = { type: data.ok ? 'success' : 'error', text: data.message };
            return loadHouse();
          }).catch(failMessage);
        }
        section.appendChild(el('div', { class: 'hk-damage' }, [
          el('div', { class: 'hk-pre', text: damage.descripcion }),
          el('div', { class: 'hk-help', text: 'Reportó: ' + damage.reportadoPor }),
          damage.foto ? el('a', { href: damage.foto, target: '_blank', rel: 'noopener noreferrer', text: 'Ver foto' }) : null,
          note,
          el('div', { class: 'hk-row' }, [
            el('button', { type: 'button', class: 'hk-secondary', text: 'Confirmar mal uso', onclick: function () { decide('mal-uso'); } }),
            el('button', { type: 'button', class: 'hk-secondary', text: 'Era desgaste', onclick: function () { decide('desgaste'); } })
          ])
        ]));
      });
    }

    if (house.cerrado) {
      section.appendChild(el('button', {
        type: 'button', class: 'hk-secondary', text: 'Reabrir el día',
        onclick: function () {
          var reason = window.prompt('¿Por qué se reabre el día? (queda anotado)');
          if (!reason) return;
          api('reopen-day', { casaId: state.casaId, fecha: state.fecha, motivo: reason }).then(function (data) {
            state.notice = { type: data.ok ? 'success' : 'error', text: data.message };
            return loadHouse();
          }).catch(failMessage);
        }
      }));
    } else {
      section.appendChild(el('p', { class: 'hk-help', text: 'Al cerrar el día, el parte de esta casa queda sellado: es lo que se usa para armar el EDP.' }));
      section.appendChild(el('button', {
        type: 'button', text: 'Cerrar el día de ' + house.casa.nombre,
        onclick: function () {
          if (!window.confirm('¿Cerrar el día ' + dateLabel(house.fecha) + ' en ' + house.casa.nombre + '? Después nadie podrá cambiarlo sin que lo reabras.')) return;
          api('close-day', { casaId: state.casaId, fecha: state.fecha }).then(function (data) {
            state.notice = { type: data.ok ? 'success' : 'error', text: data.message };
            return loadHouse();
          }).catch(failMessage);
        }
      }));
    }
    return section;
  }

  /* ---------- Registros BPM (solo supervisora) ---------- */

  function openBpm(fecha, codigo) {
    state.bpmFecha = fecha;
    return api('bpm-list', { fecha: fecha || undefined }).then(function (data) {
      if (!data.ok) {
        showNotice('error', data.message || 'No fue posible cargar los registros BPM.');
        if (!state.house && !state.bpm) renderHouses();
        return;
      }
      state.bpm = data;
      state.bpmFecha = data.fecha;
      renderBpm();
      if (codigo) {
        var wanted = data.formatos.filter(function (item) { return item.codigo === codigo; })[0];
        if (wanted) openBpmSheet(wanted);
        else showNotice('error', 'Ese formato ya no está en la lista.');
      }
    }).catch(failMessage);
  }

  function bpmState(format) {
    var done = format.hechos.length;
    if (format.tomas === 0) return done > 0 ? done + ' hoja(s) subida(s)' : 'Solo cuando ocurre';
    if (done >= format.tomas) return 'Listo (' + done + ' de ' + format.tomas + ')';
    return 'Falta (' + done + ' de ' + format.tomas + ')';
  }

  function renderBpm() {
    var data = state.bpm;
    clearScreen();
    app.appendChild(topBar(function () { state.bpm = null; state.house = null; start(); }, '‹ Volver'));
    var body = el('div', { class: 'form-body' }, [
      el('h1', { text: 'Registros BPM' }),
      el('p', { class: 'subtitle', text: state.persona.nombre + ' · ' + dateLabel(data.fecha) })
    ]);
    body.appendChild(noticeBox());
    var picker = el('input', { type: 'date', value: data.fecha, max: data.hoy });
    picker.addEventListener('change', function () { if (picker.value) { state.notice = null; openBpm(picker.value, null); } });
    body.appendChild(el('div', { class: 'hk-row' }, [picker]));
    body.appendChild(el('p', { class: 'hk-help', text: 'Las hojas siguen en papel (o plastificadas). Aquí subes la foto de cada hoja y anotas la temperatura mínima y máxima que se leyó, o «fuera de límite».' }));

    var pending = data.formatos.filter(function (item) { return item.tomas > 0 && item.hechos.length < item.tomas; }).length;
    body.appendChild(el('p', { class: 'hk-progress', text: pending === 0 ? 'No falta ninguna hoja de este día.' : 'Faltan hojas de ' + pending + ' formato(s).' }));

    var list = el('div', { class: 'hk-rooms' });
    data.formatos.forEach(function (format) {
      var card = el('div', { class: 'hk-room hk-bpm-card' }, [
        el('div', { class: 'hk-bpm-head' }, [
          el('strong', { text: format.codigo }),
          el('span', { class: 'hk-room-summary', text: format.nombre }),
          el('span', { class: 'hk-badge', text: bpmState(format) })
        ])
      ]);
      card.appendChild(el('p', { class: 'hk-help', text: [format.area, format.frecuencia].filter(Boolean).join(' · ') }));
      format.hechos.forEach(function (item) {
        var detail = [item.turno, item.punto, item.lugar].filter(Boolean).join(' · ') || 'Hoja';
        card.appendChild(el('p', { class: 'hk-help', text: (item.resultado === 'Fuera de límite' ? '⚠ ' : '✓ ') + detail + ' — ' + item.resultado }));
      });
      card.appendChild(el('button', { type: 'button', class: 'hk-secondary', text: 'Subir hoja', onclick: function () { openBpmSheet(format); } }));
      list.appendChild(card);
    });
    body.appendChild(list);
    app.appendChild(body);
  }

  function limitsText(point) {
    var parts = [];
    if (point.min !== undefined && point.min !== null) parts.push('mín. ' + point.min + ' °C');
    if (point.max !== undefined && point.max !== null) parts.push('máx. ' + point.max + ' °C');
    return parts.join(' · ');
  }

  function openBpmSheet(format) {
    var data = state.bpm;
    var submissionId = newSubmissionId();
    var turno = '';
    var cumple = null;
    var message = el('div', { class: 'message', hidden: true });
    var content = [];
    function showError(text) { message.textContent = text; message.className = 'message error'; message.hidden = false; }

    if (format.instruccion) content.push(el('p', { class: 'hk-help', text: format.instruccion }));

    var turnoRow = el('div', { class: 'hk-seg' });
    ['Mañana', 'Tarde', 'Noche'].forEach(function (option) {
      turnoRow.appendChild(el('button', {
        type: 'button', class: 'hk-seg-btn', text: option,
        onclick: function (event) {
          var already = turno === option;
          turno = already ? '' : option;
          Array.prototype.forEach.call(turnoRow.children, function (child) { child.className = 'hk-seg-btn' + (!already && child === event.currentTarget ? ' hk-seg-on' : ''); });
        }
      }));
    });
    content.push(el('label', { text: 'Turno (si la hoja lo pide)' }), turnoRow);

    var lugar = el('input', { type: 'text', placeholder: 'Equipo o lugar (ej. Cámara 1, Mantenedor)', maxlength: '120' });
    content.push(lugar);

    var punto = null;
    var minimo = null;
    var maximo = null;
    var fuera = null;
    if (format.tipo === 'Temperatura') {
      punto = el('select', { 'aria-label': 'Qué se midió' });
      format.puntos.forEach(function (item) {
        var limits = limitsText(item);
        punto.appendChild(el('option', { value: item.nombre, text: item.nombre + (limits ? ' (' + limits + ')' : '') }));
      });
      minimo = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Temperatura MÍNIMA que se leyó (°C)', maxlength: '8' });
      maximo = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Temperatura MÁXIMA que se leyó (°C)', maxlength: '8' });
      fuera = el('input', { type: 'checkbox' });
      content.push(el('label', { text: 'Qué se midió' }), punto, minimo, maximo,
        el('label', { class: 'hk-check' }, [fuera, el('span', { text: ' Fuera de límite (sin anotar números)' })]));
    } else {
      var cumpleRow = el('div', { class: 'hk-seg' });
      [['Cumple', true], ['No cumple', false]].forEach(function (pair) {
        cumpleRow.appendChild(el('button', {
          type: 'button', class: 'hk-seg-btn', text: pair[0],
          onclick: function (event) {
            cumple = pair[1];
            Array.prototype.forEach.call(cumpleRow.children, function (child) { child.className = 'hk-seg-btn' + (child === event.currentTarget ? ' hk-seg-on' : ''); });
          }
        }));
      });
      content.push(el('label', { text: 'Resultado de la hoja' }), cumpleRow);
    }

    var observacion = el('textarea', { placeholder: 'Qué se hizo si algo quedó fuera de límite (obligatorio en ese caso)', maxlength: '1000' });
    var photo = el('input', { type: 'file', id: 'hk-bpm-photo', accept: 'image/*', capture: 'environment' });
    var send = el('button', { type: 'button', text: 'Guardar la hoja' });
    content.push(observacion, el('label', { for: 'hk-bpm-photo', text: 'Foto de la hoja (obligatoria)' }), photo, message, send);

    send.addEventListener('click', function () {
      var file = photo.files && photo.files[0];
      if (!file) return showError('Saca una foto de la hoja.');
      if (format.tipo !== 'Temperatura' && cumple === null) return showError('Indica si cumple o no cumple.');
      send.disabled = true;
      send.textContent = 'Enviando…';
      compressImage(file).then(function (image) {
        var payload = {
          codigo: format.codigo, fecha: data.fecha, turno: turno || undefined, lugar: lugar.value, observacion: observacion.value,
          submissionId: submissionId, fotoBase64: image.base64, fotoContentType: image.contentType
        };
        if (format.tipo === 'Temperatura') {
          payload.punto = punto.value;
          payload.minimo = minimo.value;
          payload.maximo = maximo.value;
          payload.fuera = fuera.checked;
        } else {
          payload.cumple = cumple;
        }
        return api('bpm-record', payload);
      }).then(function (result) {
        if (!result.ok) { showError(result.message || 'No fue posible guardar la hoja.'); send.disabled = false; send.textContent = 'Guardar la hoja'; return; }
        closeSheet();
        state.notice = { type: result.fuera ? 'error' : 'success', text: result.message };
        return openBpm(data.fecha, null);
      }).catch(function (error) {
        send.disabled = false;
        send.textContent = 'Guardar la hoja';
        if (error && error.message === 'sesion') return;
        showError('No se pudo enviar. Revisa la señal e inténtalo de nuevo.');
      });
    });

    openSheet(format.codigo + ' · ' + format.nombre, content);
  }

  /* ---------- Inicio ---------- */

  function init() {
    loadStoredSession();
    if (!state.session) { renderLogin(); return; }
    start().catch(function () { /* la sesión vencida ya dibuja la entrada */ });
  }

  init();
})();
