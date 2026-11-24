const { chileWallClock, chileTomorrow } = require('./time');

/**
 * Pantalla de producción (tele del casino): qué se prepara, por empresa, para un día.
 * Lógica pura — se prueba sin SharePoint. El estado de cada fila se calcula IGUAL que el
 * panel de Solicitudes del ERP (requestStatus.ts: computeReplacedIds / getDisplayStatus),
 * para que la tele y el ERP nunca muestren cantidades distintas.
 */

/** Hasta las 20:00 (hora de Chile) se muestra el día de hoy; desde las 20:00, el día siguiente. */
const SWITCH_HOUR = '20:00';

function screenDate(now) {
  const clock = chileWallClock(now);
  return clock.slice(11, 16) >= SWITCH_HOUR ? chileTomorrow(now) : clock.slice(0, 10);
}

const FOOD_COLUMNS = ['Desayuno', 'Desayuno reforzado', 'Almuerzo', 'Almuerzo hipocalórico', 'Cena', 'Cena hipocalórica'];
const SNACK_ORDER = ['Colación sándwich', 'Colación', 'Colación reforzada', 'Colación hídrica', 'Colación desayuno', 'Colación desayuno reforzado',
  'Colación almuerzo', 'Colación cena', 'Colación cena hipocalórica', 'Bidón agua 20 litros'];
const EXCLUDED = ['Hospedaje'];

function day(value) {
  return String(value || '').slice(0, 10);
}

function isConfirmedProjection(f) {
  return f.OrigenSolicitud === 'Proyección automática' && f.EstadoSolicitud === 'Oficial';
}

/** Espejo de computeReplacedIds del ERP (requestStatus.ts). */
function computeReplacedIds(items) {
  const replaced = new Set();
  const withClientRequest = new Set();
  const keyOf = (f) => `${f.ClienteId}|${f.ContratoId == null ? '' : f.ContratoId}|${day(f.FechaServicio)}`;
  items.forEach((item) => {
    const f = item.fields;
    if (f.ReemplazaSolicitudId && f.EstadoSolicitud !== 'Extraordinaria pendiente' && f.EstadoSolicitud !== 'Anulada') {
      replaced.add(Number(f.ReemplazaSolicitudId));
    }
    if (f.EstadoSolicitud !== 'Arrastre automático' && f.EstadoSolicitud !== 'Anulada' && !isConfirmedProjection(f)) {
      withClientRequest.add(keyOf(f));
    }
  });
  items.forEach((item) => {
    if (item.fields.EstadoSolicitud === 'Arrastre automático' && withClientRequest.has(keyOf(item.fields))) replaced.add(Number(item.id));
  });
  return replaced;
}

/** Espejo de getDisplayStatus del ERP: vigente | sugerida | pendiente | historial. */
function rowStatus(item, replaced) {
  const f = item.fields;
  if (replaced.has(Number(item.id))) return 'historial';
  if (f.EstadoSolicitud === 'Arrastre automático') return 'sugerida';
  if (isConfirmedProjection(f)) return 'vigente';
  if (f.EstadoSolicitud === 'Extraordinaria pendiente') return 'pendiente';
  if (f.EstadoSolicitud === 'Anulada') return 'historial';
  return 'vigente';
}

function isSnack(type) {
  return type.indexOf('Colación') === 0 || type === 'Bidón agua 20 litros';
}

function sortSnackTypes(types) {
  return types.slice().sort((a, b) => {
    const ia = SNACK_ORDER.indexOf(a); const ib = SNACK_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
}

function contractExpected(c, date) {
  return c.Estado === 'Vigente' && day(c.FechaInicio) <= date && (!c.FechaTermino || day(c.FechaTermino) >= date)
    && Boolean(c.CodigoAccesoSolicitudes || c.EnlaceFormularioSolicitudes || c.ProyeccionAutomatica);
}

/**
 * Arma la pantalla de un día.
 * @param {{date:string, requests:Array<{id:string,fields:object}>, contracts:Array<{id:string,fields:object}>, clients:Array<{id:string,fields:object}>, rates:Array<{id:string,fields:object}>}} input
 */
function buildScreen(input) {
  const date = input.date;
  const requests = input.requests.filter((item) => day(item.fields.FechaServicio) === date && EXCLUDED.indexOf(item.fields.TipoServicio) === -1);
  const contractById = new Map(input.contracts.map((c) => [Number(c.id), c.fields]));
  const clientName = (id) => {
    const client = input.clients.find((c) => Number(c.id) === Number(id));
    return (client && (client.fields.NombreFantasia || client.fields.RazonSocial)) || `Cliente ${id}`;
  };
  const replaced = computeReplacedIds(requests);

  // Filas: un contrato por fila (igual que el panel). Contratos esperados ese día aunque no hayan pedido nada.
  const rows = new Map();
  const rowFor = (clienteId, contratoId) => {
    const key = `${clienteId}-${contratoId || 0}`;
    if (!rows.has(key)) rows.set(key, { clienteId: Number(clienteId), contratoId: Number(contratoId) || 0, vigente: [], pendiente: [], sugerida: [] });
    return rows.get(key);
  };
  input.contracts.forEach((c) => { if (contractExpected(c.fields, date)) rowFor(c.fields.ClienteId, Number(c.id)); });
  requests.forEach((item) => {
    const status = rowStatus(item, replaced);
    if (status === 'historial') return;
    rowFor(item.fields.ClienteId, item.fields.ContratoId)[status].push(item.fields);
  });

  const rowList = Array.from(rows.values());
  const clientCount = new Map();
  rowList.forEach((r) => clientCount.set(r.clienteId, (clientCount.get(r.clienteId) || 0) + 1));

  const snackTypes = new Set();
  const foodExtra = new Set();
  rowList.forEach((r) => [].concat(r.vigente, r.pendiente, r.sugerida).forEach((f) => {
    if (isSnack(f.TipoServicio)) snackTypes.add(f.TipoServicio);
    else if (FOOD_COLUMNS.indexOf(f.TipoServicio) === -1) foodExtra.add(f.TipoServicio);
  }));
  const foodColumns = FOOD_COLUMNS.concat(Array.from(foodExtra).sort());
  const snackColumns = sortSnackTypes(Array.from(snackTypes));

  const summarize = (list) => list.map((f) => `${f.TipoServicio}${f.HoraServicio ? ` ${f.HoraServicio}` : ''}: ${Number(f.CantidadOficial) || 0}`).join(' · ');

  const view = rowList.map((r) => {
    const contract = contractById.get(r.contratoId);
    const alias = contract && contract.ApodoServicio ? String(contract.ApodoServicio).trim() : '';
    const showContract = Boolean(contract) && (alias !== '' || clientCount.get(r.clienteId) > 1);
    const situation = r.pendiente.length > 0 ? 'pendiente' : r.sugerida.length > 0 ? 'sugerida' : r.vigente.length > 0 ? 'lista' : 'sin-solicitud';
    const foodOf = (list) => {
      const out = {};
      foodColumns.forEach((col) => {
        const qty = list.filter((f) => f.TipoServicio === col).reduce((t, f) => t + (Number(f.CantidadOficial) || 0), 0);
        if (qty > 0) out[col] = qty;
      });
      return out;
    };
    const snacksOf = (list) => {
      const out = {};
      snackColumns.forEach((col) => {
        const blocks = list.filter((f) => f.TipoServicio === col && (Number(f.CantidadOficial) || 0) > 0)
          .sort((a, b) => String(a.HoraServicio || '').localeCompare(String(b.HoraServicio || '')))
          .map((f) => ({ cantidad: Number(f.CantidadOficial), hora: f.HoraServicio || '', nota: String(f.Observacion || '').trim() }));
        if (blocks.length > 0) out[col] = blocks;
      });
      return out;
    };
    const food = foodOf(r.vigente);
    const snacks = snacksOf(r.vigente);
    // Lo que el cliente pidió fuera de plazo y nadie ha decidido: se ve (en amarillo) pero no se suma.
    const pendingFood = foodOf(r.pendiente);
    const pendingSnacks = snacksOf(r.pendiente);
    const notes = [];
    if (situation === 'pendiente') notes.push('Pendiente de decisión en el ERP: lo marcado «por aprobar» no se suma al total');
    if (situation === 'sugerida') notes.push(`Sin solicitud del cliente — sugerido: ${summarize(r.sugerida)}`);
    if (situation === 'sin-solicitud') notes.push('Sin solicitud');
    r.vigente.filter((f) => !isSnack(f.TipoServicio) && String(f.Observacion || '').trim() !== '')
      .forEach((f) => notes.push(`${f.TipoServicio}: ${String(f.Observacion).trim()}`));
    return {
      empresa: clientName(r.clienteId),
      contrato: showContract ? (alias || contract.NumeroContrato || '') : '',
      situacion: situation,
      alimentacion: food,
      colaciones: snacks,
      alimentacionPorAprobar: pendingFood,
      colacionesPorAprobar: pendingSnacks,
      observaciones: notes.join(' | ')
    };
  }).sort((a, b) => a.empresa.localeCompare(b.empresa) || a.contrato.localeCompare(b.contrato));

  const foodTotals = {};
  foodColumns.forEach((col) => { foodTotals[col] = view.reduce((t, r) => t + (r.alimentacion[col] || 0), 0); });
  const snackTotals = {};
  snackColumns.forEach((col) => { snackTotals[col] = view.reduce((t, r) => t + (r.colaciones[col] || []).reduce((s, b) => s + b.cantidad, 0), 0); });

  // Bajo cada tipo de colación: lo que incluye, según las tarifas activas de los contratos que la pidieron.
  const contractsWithSnack = (col) => new Set(rowList.filter((r) => r.vigente.concat(r.pendiente).some((f) => f.TipoServicio === col)).map((r) => r.contratoId));
  const snackHeaders = snackColumns.map((col) => {
    const ids = contractsWithSnack(col);
    const descriptions = Array.from(new Set((input.rates || [])
      .filter((rate) => rate.fields.Activo !== false && rate.fields.TipoServicio === col && ids.has(Number(rate.fields.ContratoId)))
      .map((rate) => String(rate.fields.Descripcion || '').trim())
      .filter((text) => text !== '' && text.toLowerCase() !== col.toLowerCase())));
    return { tipo: col, incluye: descriptions };
  });

  // Fila de una empresa en una tabla solo si tiene algo que mostrar en esa tabla.
  const has = (o) => Object.keys(o).length > 0;
  const foodRows = view.filter((r) => has(r.alimentacion) || has(r.alimentacionPorAprobar) || r.observaciones !== '' || !(has(r.colaciones) || has(r.colacionesPorAprobar)));
  const snackRows = view.filter((r) => has(r.colaciones) || has(r.colacionesPorAprobar));

  return {
    fecha: date,
    alimentacion: { columnas: foodColumns.filter((col) => FOOD_COLUMNS.indexOf(col) !== -1 || foodTotals[col] > 0), filas: foodRows, totales: foodTotals },
    colaciones: { columnas: snackHeaders, filas: snackRows, totales: snackTotals }
  };
}

module.exports = { screenDate, buildScreen, computeReplacedIds, rowStatus, SWITCH_HOUR };
