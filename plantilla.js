/**
 * Plantilla de pedidos en Excel (.xlsx): crearla y leerla, SIN librerías.
 *
 * Un .xlsx es un archivo comprimido (zip) con texto XML adentro. Aquí se escribe un zip sin
 * compresión (suficiente y simple) y se lee uno comprimido con DecompressionStream, que ya trae
 * el navegador. Todo ocurre en el navegador del cliente; el servidor nunca abre el archivo: solo
 * recibe los números ya leídos y los vuelve a validar él mismo.
 *
 * Funciona igual en el navegador (window.IchPlantilla) y en Node (require), para poder probarlo.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IchPlantilla = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITE_ENTRADAS = 100;
  var LIMITE_ARCHIVO = 10 * 1024 * 1024;
  var LIMITE_TOTAL = 30 * 1024 * 1024;
  var DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  // ------------------------------------------------------------------ zip (escribir, sin comprimir)
  var crcTable = null;
  function crc32(bytes) {
    if (crcTable === null) {
      crcTable = new Uint32Array(256);
      for (var n = 0; n < 256; n += 1) {
        var c = n;
        for (var k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function zipStore(files) {
    var encoder = new TextEncoder();
    var locals = [];
    var centrals = [];
    var offset = 0;
    files.forEach(function (file) {
      var name = encoder.encode(file.name);
      var data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
      var crc = crc32(data);
      var local = new Uint8Array(30 + name.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
      lv.setUint16(10, 0, true); lv.setUint16(12, 0x0021, true); lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
      local.set(name, 30);
      var central = new Uint8Array(46 + name.length);
      var cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x0021, true); cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      central.set(name, 46);
      locals.push(local, data);
      centrals.push(central);
      offset += local.length + data.length;
    });
    var centralSize = centrals.reduce(function (sum, part) { return sum + part.length; }, 0);
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
    var parts = locals.concat(centrals, [end]);
    var total = parts.reduce(function (sum, part) { return sum + part.length; }, 0);
    var out = new Uint8Array(total);
    var position = 0;
    parts.forEach(function (part) { out.set(part, position); position += part.length; });
    return out;
  }

  // ------------------------------------------------------------------ zip (leer)
  function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('Tu navegador es muy antiguo para leer Excel. Actualízalo o usa Chrome o Edge.'));
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (buffer) { return new Uint8Array(buffer); });
  }

  /** Devuelve { 'xl/workbook.xml': Uint8Array, ... } con límites para no abrir archivos absurdos. */
  function readZip(buffer) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error('El archivo no parece un Excel (.xlsx).'));
    var count = view.getUint16(eocd + 10, true);
    var position = view.getUint32(eocd + 16, true);
    if (count > LIMITE_ENTRADAS) return Promise.reject(new Error('El archivo trae demasiadas partes: no parece una plantilla.'));
    var decoder = new TextDecoder();
    var entries = [];
    var total = 0;
    for (var e = 0; e < count; e += 1) {
      if (position + 46 > bytes.length || view.getUint32(position, true) !== 0x02014b50) return Promise.reject(new Error('El archivo Excel está dañado.'));
      var method = view.getUint16(position + 10, true);
      var compressed = view.getUint32(position + 20, true);
      var size = view.getUint32(position + 24, true);
      var nameLength = view.getUint16(position + 28, true);
      var extraLength = view.getUint16(position + 30, true);
      var commentLength = view.getUint16(position + 32, true);
      var local = view.getUint32(position + 42, true);
      var name = decoder.decode(bytes.subarray(position + 46, position + 46 + nameLength));
      if (size > LIMITE_ARCHIVO) return Promise.reject(new Error('El archivo es demasiado grande para ser una plantilla.'));
      total += size;
      if (total > LIMITE_TOTAL) return Promise.reject(new Error('El archivo es demasiado grande para ser una plantilla.'));
      entries.push({ name: name, method: method, compressed: compressed, local: local });
      position += 46 + nameLength + extraLength + commentLength;
    }
    var out = {};
    return entries.reduce(function (chain, entry) {
      return chain.then(function () {
        if (entry.local + 30 > bytes.length) throw new Error('El archivo Excel está dañado.');
        var dataStart = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
        var raw = bytes.subarray(dataStart, dataStart + entry.compressed);
        if (entry.method === 0) { out[entry.name] = raw; return undefined; }
        if (entry.method === 8) return inflateRaw(raw).then(function (data) { out[entry.name] = data; });
        throw new Error('El archivo Excel usa un formato de compresión que no se puede leer.');
      });
    }, Promise.resolve()).then(function () { return out; });
  }

  // ------------------------------------------------------------------ XML mínimo
  function escapeXml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function unescapeXml(value) {
    return String(value)
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, hex) { return String.fromCodePoint(parseInt(hex, 16)); })
      .replace(/&#(\d+);/g, function (_, dec) { return String.fromCodePoint(parseInt(dec, 10)); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  function textOf(xml) {
    var parts = [];
    xml.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, function (_, text) { parts.push(unescapeXml(text)); return ''; });
    return parts.join('');
  }
  function colIndex(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i += 1) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }
  function colLetters(index) {
    var n = index + 1;
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  // ------------------------------------------------------------------ fechas
  function serialToIso(serial) {
    var ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  function isoToSerial(iso) {
    var p = iso.split('-').map(Number);
    return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(1899, 11, 30)) / 86400000);
  }
  function addDays(iso, n) {
    var p = iso.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }
  function weekdayName(iso) {
    var p = iso.split('-').map(Number);
    return DIAS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  }
  /** Acepta número de serie de Excel, 2026-10-20, 20-10-2026 o 20/10/2026. */
  function parseFecha(cell) {
    if (cell === undefined) return undefined;
    if (cell.numero !== undefined) return cell.numero > 20000 && cell.numero < 80000 ? serialToIso(cell.numero) : undefined;
    var text = String(cell.texto || '').trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (m) return text;
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
    if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return undefined;
  }
  /** Horario como texto «06:30», «6:30», o como fracción de día que Excel guarda si se escribió como hora. */
  function parseHorario(cell) {
    if (cell === undefined) return '';
    if (cell.numero !== undefined) {
      if (cell.numero < 0 || cell.numero >= 1) return '';
      var minutes = Math.round(cell.numero * 24 * 60);
      return ('0' + Math.floor(minutes / 60)).slice(-2) + ':' + ('0' + (minutes % 60)).slice(-2);
    }
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(cell.texto || '').trim());
    return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : String(cell.texto || '').trim();
  }

  // ------------------------------------------------------------------ crear la plantilla
  var S = { normal: 0, title: 1, head: 2, date: 3, day: 4, num: 5, note: 6, bold: 7, txt: 9 };
  function strCell(ref, text, style) { return '<c r="' + ref + '" s="' + (style || 0) + '" t="inlineStr"><is><t xml:space="preserve">' + escapeXml(text) + '</t></is></c>'; }
  function numCell(ref, n, style) { return '<c r="' + ref + '" s="' + (style || 0) + '"><v>' + n + '</v></c>'; }
  function blankCell(ref, style) { return '<c r="' + ref + '" s="' + style + '"/>'; }
  function rowXml(r, cells, height) { return '<row r="' + r + '"' + (height ? ' ht="' + height + '" customHeight="1"' : '') + '>' + cells.join('') + '</row>'; }
  function sheetXml(opts) {
    var pane = opts.freeze ? '<pane xSplit="' + opts.freeze.x + '" ySplit="' + opts.freeze.y + '" topLeftCell="' + colLetters(opts.freeze.x) + (opts.freeze.y + 1) + '" activePane="' + (opts.freeze.x > 0 ? 'bottomRight' : 'bottomLeft') + '" state="frozen"/>' : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0">' + pane + '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>' +
      opts.cols.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') +
      '</cols><sheetData>' + opts.rows.join('') + '</sheetData>' + (opts.validations || '') + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
  }

  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\-mm\\-yyyy"/></numFmts>' +
    '<fonts count="5"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="14"/><color rgb="FF1F4E79"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><i/><sz val="9"/><color rgb="FF595959"/><name val="Arial"/></font></fonts>' +
    '<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="10">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="1" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="49" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  /** Texto del plazo, igual que lo aplica el servidor: hora de cierre del canal y anticipación del contrato. */
  function textoPlazo(horaCierre, horasAnticipacion) {
    var horas = Number(horasAnticipacion) > 0 ? Number(horasAnticipacion) : 24;
    var dias = Math.max(1, Math.ceil(horas / 24));
    var hora = horaCierre || '18:00';
    return dias === 1
      ? 'Cada día se puede pedir hasta las ' + hora + ' del día anterior.'
      : 'Cada día se puede pedir hasta las ' + hora + ', con ' + dias + ' días de anticipación.';
  }

  /**
   * cfg: { cliente, codigo, descripcion, horaCierre, horasAnticipacion, servicios[] (los autorizados del contrato,
   * incluidas las colaciones), inicio ('YYYY-MM-DD'), dias (cuántos días mostrar), diasServicio (['Lunes',…], vacío = todos) }.
   * Cada cliente recibe una plantilla distinta porque sus servicios, días y plazos son distintos.
   */
  function build(cfg) {
    var colaciones = cfg.servicios.filter(function (name) { return name.indexOf('Colación') === 0; });
    var comidas = cfg.servicios.filter(function (name) { return name.indexOf('Colación') !== 0; });
    var diasServicio = (cfg.diasServicio || []).map(function (day) { return String(day).toLowerCase(); });
    var fechas = [];
    for (var i = 0; i < (cfg.dias || 31); i += 1) {
      var iso = addDays(cfg.inicio, i);
      if (diasServicio.length === 0 || diasServicio.indexOf(weekdayName(iso).toLowerCase()) !== -1) fechas.push(iso);
    }
    var autorizados = cfg.servicios.join(' · ');

    var instr = [];
    instr.push(rowXml(1, [strCell('A1', 'Plantilla de pedidos de alimentación', S.title)], 26));
    instr.push(rowXml(3, [strCell('A3', 'Cliente', S.bold), strCell('B3', cfg.cliente)]));
    instr.push(rowXml(4, [strCell('A4', 'Contrato', S.bold), strCell('B4', cfg.codigo + (cfg.descripcion ? ' · ' + cfg.descripcion : ''))]));
    instr.push(rowXml(5, [strCell('A5', 'Código de la plantilla', S.bold), strCell('B5', cfg.codigo)]));
    instr.push(rowXml(6, [strCell('A6', 'Plazo para pedir', S.bold), strCell('B6', textoPlazo(cfg.horaCierre, cfg.horasAnticipacion))]));
    instr.push(rowXml(7, [strCell('A7', 'Servicios de este contrato', S.bold), strCell('B7', autorizados)]));
    instr.push(rowXml(9, [strCell('A9', 'Cómo llenarla', S.bold)]));
    var pasos = [
      ['1', 'En la hoja «Pedidos» escribe, en cada día, cuántas raciones de cada servicio necesitas.'],
      ['2', 'Casilla EN BLANCO = no cambias nada ese día (sigue el último pedido o la repetición automática).'],
      ['3', 'Escribe 0 solo si ese día NO quieres ese servicio.']
    ];
    if (colaciones.length > 0) pasos.push(['4', 'Las colaciones van en la hoja «Colaciones»: una fila por horario (fecha, hora, servicio y cantidad).']);
    pasos.push(['5', 'No cambies los encabezados, las fechas ni el código de arriba. Guarda el archivo como Excel (.xlsx).']);
    pasos.push(['6', 'Súbelo en la página de pedidos. Antes de enviarlo verás un resumen; recién ahí se confirma.']);
    pasos.push(['7', 'Si subes una versión nueva, vale la última. Los días fuera de plazo quedan pendientes de aceptación.']);
    pasos.forEach(function (paso, index) {
      var r = 10 + index;
      instr.push(rowXml(r, [strCell('A' + r, paso[0], S.bold), strCell('B' + r, paso[1], S.note)], 30));
    });
    var ejemploFila = 10 + pasos.length + 1;
    var ejemplo = comidas.slice(0, 3).map(function (name) { return name + ' 4'; }).join(', ');
    instr.push(rowXml(ejemploFila, [strCell('A' + ejemploFila, 'Ejemplo', S.bold), strCell('B' + ejemploFila, 'Si un día escribes ' + (ejemplo || 'Almuerzo 4') + ', ese día se piden esas cantidades. Lo que dejes en blanco no se toca.', S.note)], 30));
    var sheet1 = sheetXml({ cols: [28, 100], rows: instr });

    var pedidosHeader = ['Fecha', 'Día'].concat(comidas);
    var pedidos = [rowXml(1, pedidosHeader.map(function (h, idx) { return strCell(colLetters(idx) + '1', h, S.head); }), 32)];
    fechas.forEach(function (iso, idx) {
      var r = idx + 2;
      var cells = [numCell('A' + r, isoToSerial(iso), S.date), strCell('B' + r, weekdayName(iso), S.day)];
      comidas.forEach(function (_, k) { cells.push(blankCell(colLetters(2 + k) + r, S.num)); });
      pedidos.push(rowXml(r, cells));
    });
    var lastRow = fechas.length + 1;
    var lastCol = colLetters(1 + comidas.length);
    var pedidosValidation = comidas.length === 0 ? '' : '<dataValidations count="1"><dataValidation type="whole" operator="greaterThanOrEqual" allowBlank="1" showErrorMessage="1" errorTitle="Cantidad no válida" error="Escribe un número entero (0 o más) o deja la casilla en blanco." sqref="C2:' + lastCol + lastRow + '"><formula1>0</formula1></dataValidation></dataValidations>';
    var sheet2 = sheetXml({ cols: [14, 14].concat(comidas.map(function () { return 16; })), rows: pedidos, freeze: { x: 2, y: 1 }, validations: pedidosValidation });

    var sheets = [{ name: 'Instrucciones', xml: sheet1 }, { name: 'Pedidos', xml: sheet2 }];
    if (colaciones.length > 0) {
      var colRows = [rowXml(1, ['Fecha', 'Horario (HH:MM)', 'Servicio', 'Cantidad'].map(function (h, idx) { return strCell(colLetters(idx) + '1', h, S.head); }), 32)];
      for (var r = 2; r <= 41; r += 1) colRows.push(rowXml(r, [blankCell('A' + r, S.date), blankCell('B' + r, S.txt), blankCell('C' + r, S.txt), blankCell('D' + r, S.num)]));
      var first = isoToSerial(cfg.inicio);
      var finish = isoToSerial(addDays(cfg.inicio, (cfg.dias || 31) - 1));
      var colValidation = '<dataValidations count="3">' +
        '<dataValidation type="date" operator="between" allowBlank="1" showErrorMessage="1" errorTitle="Fecha fuera del rango" error="Usa una fecha dentro del período de esta plantilla." sqref="A2:A41"><formula1>' + first + '</formula1><formula2>' + finish + '</formula2></dataValidation>' +
        '<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Servicio no válido" error="Elige un servicio de la lista." sqref="C2:C41"><formula1>"' + colaciones.join(',') + '"</formula1></dataValidation>' +
        '<dataValidation type="whole" operator="greaterThanOrEqual" allowBlank="1" showErrorMessage="1" errorTitle="Cantidad no válida" error="Escribe un número entero (0 o más)." sqref="D2:D41"><formula1>0</formula1></dataValidation></dataValidations>';
      sheets.push({ name: 'Colaciones', xml: sheetXml({ cols: [14, 18, 24, 12], rows: colRows, freeze: { x: 0, y: 1 }, validations: colValidation }) });
    }

    var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="1"/></bookViews><sheets>' +
      sheets.map(function (sheet, idx) { return '<sheet name="' + sheet.name + '" sheetId="' + (idx + 1) + '" r:id="rId' + (idx + 1) + '"/>'; }).join('') + '</sheets></workbook>';
    var workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (_, idx) { return '<Relationship Id="rId' + (idx + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (idx + 1) + '.xml"/>'; }).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map(function (_, idx) { return '<Override PartName="/xl/worksheets/sheet' + (idx + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';

    var files = [
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rels },
      { name: 'xl/workbook.xml', data: workbook },
      { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
      { name: 'xl/styles.xml', data: STYLES }
    ];
    sheets.forEach(function (sheet, idx) { files.push({ name: 'xl/worksheets/sheet' + (idx + 1) + '.xml', data: sheet.xml }); });
    return zipStore(files);
  }

  // ------------------------------------------------------------------ leer la plantilla llenada
  function parseSharedStrings(xml) {
    var list = [];
    xml.replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, function (_, inner) { list.push(textOf(inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''))); return ''; });
    return list;
  }

  /** { 'A1': { numero?, texto? } } — vacías no aparecen. */
  function parseSheet(xml, shared) {
    var cells = {};
    xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, function (_, attrs, inner) {
      var ref = /\br="([A-Z]+\d+)"/.exec(attrs);
      if (ref === null || inner === undefined) return '';
      var type = (/\bt="([^"]*)"/.exec(attrs) || [])[1];
      var value = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
      var cell;
      if (type === 'inlineStr') cell = { texto: textOf(inner) };
      else if (type === 's' && value !== undefined) cell = { texto: shared[Number(value)] };
      else if (type === 'str' && value !== undefined) cell = { texto: unescapeXml(value) };
      else if (value !== undefined && value !== '') cell = isFinite(Number(value)) ? { numero: Number(value), texto: value } : { texto: unescapeXml(value) };
      if (cell !== undefined && (cell.numero !== undefined || String(cell.texto || '').trim() !== '')) cells[ref[1]] = cell;
      return '';
    });
    return cells;
  }

  function cellsByRow(cells) {
    var rows = {};
    Object.keys(cells).forEach(function (ref) {
      var m = /^([A-Z]+)(\d+)$/.exec(ref);
      var r = Number(m[2]);
      if (rows[r] === undefined) rows[r] = {};
      rows[r][colIndex(m[1])] = cells[ref];
    });
    return rows;
  }

  function quantity(cell, ref, errores) {
    if (cell === undefined) return undefined;
    var n = cell.numero !== undefined ? cell.numero : Number(String(cell.texto).trim().replace(',', '.'));
    if (!isFinite(n) || Math.floor(n) !== n || n < 0) { errores.push('«' + String(cell.texto).slice(0, 20) + '» en ' + ref + ' no es una cantidad válida (usa un número entero).'); return undefined; }
    return n;
  }

  /**
   * Lee el Excel llenado. Devuelve { codigo, dias: [{ fecha, servicios: [{ tipoServicio, cantidad, horario? }] }], errores }.
   * Las casillas en blanco no producen nada; un 0 sí (significa «ese día no quiero ese servicio»).
   */
  function read(buffer) {
    return readZip(buffer).then(function (zip) {
      var decoder = new TextDecoder();
      var text = function (name) { return zip[name] ? decoder.decode(zip[name]) : undefined; };
      var workbook = text('xl/workbook.xml');
      var rels = text('xl/_rels/workbook.xml.rels');
      if (workbook === undefined || rels === undefined) throw new Error('El archivo no parece una plantilla de Excel.');
      var targets = {};
      rels.replace(/<Relationship\b([^>]*?)\/?>/g, function (_, attrs) {
        var id = (/\bId="([^"]*)"/.exec(attrs) || [])[1];
        var target = (/\bTarget="([^"]*)"/.exec(attrs) || [])[1];
        if (id && target) targets[id] = target.replace(/^\/?(xl\/)?/, 'xl/');
        return '';
      });
      var shared = text('xl/sharedStrings.xml') ? parseSharedStrings(text('xl/sharedStrings.xml')) : [];
      var sheetsByName = {};
      workbook.replace(/<sheet\b([^>]*?)\/?>/g, function (_, attrs) {
        var name = (/\bname="([^"]*)"/.exec(attrs) || [])[1];
        var rid = (/\br:id="([^"]*)"/.exec(attrs) || [])[1];
        if (name && rid && targets[rid] && text(targets[rid])) sheetsByName[unescapeXml(name)] = parseSheet(text(targets[rid]), shared);
        return '';
      });
      var errores = [];
      var instrucciones = sheetsByName['Instrucciones'];
      var pedidos = sheetsByName['Pedidos'];
      if (instrucciones === undefined || pedidos === undefined) throw new Error('No encuentro las hojas «Instrucciones» y «Pedidos»: usa la plantilla que descargaste de esta página.');

      var codigo = '';
      var instrRows = cellsByRow(instrucciones);
      Object.keys(instrRows).forEach(function (r) {
        var label = instrRows[r][0];
        if (label && /c[oó]digo de la plantilla/i.test(String(label.texto))) codigo = instrRows[r][1] ? String(instrRows[r][1].texto).trim() : '';
      });

      var days = {};
      var add = function (fecha, item) { (days[fecha] = days[fecha] || []).push(item); };

      var rows = cellsByRow(pedidos);
      var header = rows[1] || {};
      var columns = [];
      Object.keys(header).forEach(function (index) {
        var name = String(header[index].texto).trim();
        if (Number(index) >= 2 && name !== '') columns.push({ index: Number(index), name: name });
      });
      Object.keys(rows).map(Number).filter(function (r) { return r >= 2; }).sort(function (a, b) { return a - b; }).forEach(function (r) {
        var fecha = parseFecha(rows[r][0]);
        var hasValues = columns.some(function (column) { return rows[r][column.index] !== undefined; });
        if (fecha === undefined) {
          if (hasValues) errores.push('La fila ' + r + ' de «Pedidos» tiene cantidades pero no una fecha válida.');
          return;
        }
        columns.forEach(function (column) {
          var cell = rows[r][column.index];
          var n = quantity(cell, 'Pedidos!' + colLetters(column.index) + r, errores);
          if (n !== undefined) add(fecha, { tipoServicio: column.name, cantidad: n });
        });
      });

      var colaciones = sheetsByName['Colaciones'];
      if (colaciones !== undefined) {
        var colRows = cellsByRow(colaciones);
        var colHeader = colRows[1] || {};
        var at = {};
        Object.keys(colHeader).forEach(function (index) {
          var h = String(colHeader[index].texto).toLowerCase();
          if (h.indexOf('fecha') === 0) at.fecha = Number(index);
          else if (h.indexOf('horario') === 0) at.horario = Number(index);
          else if (h.indexOf('servicio') === 0) at.servicio = Number(index);
          else if (h.indexOf('cantidad') === 0) at.cantidad = Number(index);
        });
        Object.keys(colRows).map(Number).filter(function (r) { return r >= 2; }).sort(function (a, b) { return a - b; }).forEach(function (r) {
          var row = colRows[r];
          var parts = [row[at.fecha], row[at.horario], row[at.servicio], row[at.cantidad]];
          if (parts.every(function (part) { return part === undefined; })) return;
          var fecha = parseFecha(row[at.fecha]);
          var servicio = row[at.servicio] ? String(row[at.servicio].texto).trim() : '';
          var horario = parseHorario(row[at.horario]);
          var n = quantity(row[at.cantidad], 'Colaciones!' + colLetters(at.cantidad) + r, errores);
          if (fecha === undefined || servicio === '' || horario === '' || row[at.cantidad] === undefined) {
            errores.push('La fila ' + r + ' de «Colaciones» está incompleta: hacen falta fecha, horario, servicio y cantidad.');
            return;
          }
          if (n !== undefined) add(fecha, { tipoServicio: servicio, cantidad: n, horario: horario });
        });
      }

      var dias = Object.keys(days).sort().map(function (fecha) { return { fecha: fecha, servicios: days[fecha] }; });
      return { codigo: codigo, dias: dias, errores: errores };
    });
  }

  return { build: build, read: read, textoPlazo: textoPlazo, _zipStore: zipStore, _readZip: readZip };
});
