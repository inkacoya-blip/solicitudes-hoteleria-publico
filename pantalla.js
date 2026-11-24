(function () {
  'use strict';
  // El token llega una sola vez en el enlace (#/p/<token>); se guarda en este navegador y se borra de la barra.
  var KEY = 'ich-pantalla-token';
  var REFRESH_MS = 2 * 60 * 1000;
  var match = /^#\/p\/([0-9a-f]{64})$/.exec(window.location.hash);
  if (match) {
    try { window.localStorage.setItem(KEY, match[1]); } catch (e) { /* sin almacenamiento: solo en memoria */ }
    window.history.replaceState(null, '', window.location.pathname);
  }
  var token = match ? match[1] : (function () { try { return window.localStorage.getItem(KEY); } catch (e) { return null; } })();

  var app = document.getElementById('app');
  var titulo = document.getElementById('titulo');
  var estado = document.getElementById('estado');
  var reloj = document.getElementById('reloj');
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  }
  function fechaLarga(iso) {
    var p = iso.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return DIAS[d.getUTCDay()] + ' ' + String(p[2]).padStart(2, '0') + '-' + String(p[1]).padStart(2, '0') + '-' + p[0];
  }
  function tick() {
    reloj.textContent = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  }
  function empresaCell(fila) {
    return '<td class="empresa">' + esc(fila.empresa) + (fila.contrato ? '<small>' + esc(fila.contrato) + '</small>' : '') + '</td>';
  }

  function render(data) {
    var hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
    titulo.textContent = (data.fecha === hoy ? 'Hoy, ' : 'Mañana, ') + fechaLarga(data.fecha);

    var a = data.alimentacion;
    var html = '<h2>Alimentación</h2>';
    if (a.filas.length === 0) {
      html += '<p class="vacio">Sin solicitudes de alimentación para este día.</p>';
    } else {
      html += '<table><thead><tr><th class="empresa-col">Empresa</th>' + a.columnas.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') +
        '<th class="obs-col">Observaciones</th></tr></thead><tbody>';
      a.filas.forEach(function (f) {
        html += '<tr class="' + esc(f.situacion) + '">' + empresaCell(f) +
          a.columnas.map(function (c) {
            var pend = (f.alimentacionPorAprobar || {})[c];
            return '<td class="num">' + (f.alimentacion[c] || '') + (pend ? '<span class="por-aprobar">' + pend + '<small>por aprobar</small></span>' : '') + '</td>';
          }).join('') +
          '<td class="obs">' + esc(f.observaciones) + '</td></tr>';
      });
      html += '<tr class="total"><td class="empresa">TOTAL</td>' + a.columnas.map(function (c) { return '<td class="num">' + (a.totales[c] || '') + '</td>'; }).join('') + '<td></td></tr></tbody></table>';
    }

    var s = data.colaciones;
    html += '<h2>Colaciones</h2>';
    if (s.filas.length === 0) {
      html += '<p class="vacio">Sin colaciones para este día.</p>';
    } else {
      html += '<table><thead><tr><th class="empresa-col">Empresa</th>' + s.columnas.map(function (c) {
        return '<th>' + esc(c.tipo) + (c.incluye.length ? '<small>' + c.incluye.map(esc).join('<br>') + '</small>' : '') + '</th>';
      }).join('') + '</tr></thead><tbody>';
      s.filas.forEach(function (f) {
        html += '<tr class="' + esc(f.situacion) + '">' + empresaCell(f) + s.columnas.map(function (c) {
          var bloque = function (b, pendiente) {
            return '<span class="bloque' + (pendiente ? ' por-aprobar' : '') + '">' + b.cantidad + (b.hora ? ' / ' + esc(b.hora) : '') +
              (b.nota ? '<small>' + esc(b.nota) + '</small>' : '') + (pendiente ? '<small>por aprobar</small>' : '') + '</span>';
          };
          return '<td>' + (f.colaciones[c.tipo] || []).map(function (b) { return bloque(b, false); }).join('') +
            ((f.colacionesPorAprobar || {})[c.tipo] || []).map(function (b) { return bloque(b, true); }).join('') + '</td>';
        }).join('') + '</tr>';
      });
      html += '<tr class="total"><td class="empresa">TOTAL</td>' + s.columnas.map(function (c) { return '<td class="num">' + (s.totales[c.tipo] || '') + '</td>'; }).join('') + '</tr></tbody></table>';
    }

    app.innerHTML = html;
    estado.className = '';
    estado.textContent = 'Actualizado ' + data.actualizado.slice(11) + ' · a las 20:00 pasa al día siguiente';
  }

  function load() {
    if (!token) {
      titulo.textContent = 'Pantalla sin enlace';
      app.innerHTML = '<p class="aviso">Abre en esta pantalla el enlace que entrega el ERP en Solicitudes › Panel › «Enlace para pantalla».</p>';
      estado.textContent = '';
      return;
    }
    fetch('/api/screen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token }) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) { render(data); return; }
        estado.className = 'error';
        estado.textContent = data.message || 'No se pudo cargar.';
        if (/no válido/i.test(data.message || '')) {
          titulo.textContent = 'Enlace no válido';
          app.innerHTML = '<p class="aviso">' + esc(data.message) + '</p>';
        }
      })
      .catch(function () {
        estado.className = 'error';
        estado.textContent = 'Sin conexión — se muestra lo último recibido, reintentando…';
      });
  }

  tick();
  window.setInterval(tick, 15000);
  load();
  window.setInterval(load, REFRESH_MS);
  // Recarga completa cada 6 horas: toma cualquier mejora publicada sin tocar la tele.
  window.setTimeout(function () { window.location.reload(); }, 6 * 60 * 60 * 1000);
})();
