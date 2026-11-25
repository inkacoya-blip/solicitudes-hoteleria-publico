/**
 * Pedido fijo de un contrato (ICH_CONTRATOS.PedidoFijo, JSON). Mismo formato que fixedOrderCore.ts del ERP:
 * [{ TipoServicio, Cantidad, Dias: ['Lunes'…'Domingo'], Hora? }]. Cada día, el arrastre de las 18:05 deja
 * registradas como solicitudes OFICIALES las líneas que corresponden al día siguiente.
 */
const BY_INDEX = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function parseFixedOrder(json) {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((line) => line && typeof line.TipoServicio === 'string' && Number(line.Cantidad) > 0 && Array.isArray(line.Dias))
      .map((line) => ({ TipoServicio: line.TipoServicio, Cantidad: Number(line.Cantidad), Dias: line.Dias.filter((day) => BY_INDEX.includes(day)), Hora: line.Hora || undefined }));
  } catch {
    return [];
  }
}

/** Líneas del pedido fijo que tocan en fechaIso (YYYY-MM-DD). */
function fixedOrderLinesFor(json, fechaIso) {
  const [y, m, d] = fechaIso.split('-').map(Number);
  const day = BY_INDEX[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return parseFixedOrder(json).filter((line) => line.Dias.includes(day));
}

/** El pedido fijo aplica a contratos vigentes o pendientes de firma (ya operando), dentro de sus fechas. */
function contractTakesFixedOrder(fields, fechaIso) {
  if (fields.Estado !== 'Vigente' && fields.Estado !== 'Pendiente de firma') return false;
  if (fields.FechaInicio && String(fields.FechaInicio).slice(0, 10) > fechaIso) return false;
  if (fields.FechaTermino && String(fields.FechaTermino).slice(0, 10) < fechaIso) return false;
  return parseFixedOrder(fields.PedidoFijo).length > 0;
}

module.exports = { parseFixedOrder, fixedOrderLinesFor, contractTakesFixedOrder };
