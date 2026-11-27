/**
 * Estado a mostrar en "Mis solicitudes": 'Oficial'/'Extraordinaria pendiente'/
 * 'Arrastre automático'/'Anulada' de la fila, o 'reemplazada' si OTRA fila mas reciente
 * la superó (ReemplazaSolicitudId). Nunca se sobrescribe el registro original — esto es
 * puramente una etiqueta calculada para mostrar.
 */
function displayStatus(item, replacedIds) {
  // item.id llega como string desde Graph; ReemplazaSolicitudId se guarda como Number en
  // SharePoint — sin este Number(), Set.has() nunca coincide (comparación estricta de tipos).
  if (replacedIds.has(Number(item.id))) return 'reemplazada';
  const estado = item.fields.EstadoSolicitud;
  if (estado === 'Arrastre automático') return 'oficial-automatica';
  if (estado === 'Extraordinaria pendiente') return 'extraordinaria-pendiente';
  if (estado === 'Anulada') return 'no-aceptada';
  return 'oficial-cliente';
}

/** Ids (Number) de todas las filas que otra fila más reciente reemplazó. */
function computeReplacedIds(items) {
  const replacedIds = new Set();
  items.forEach((item) => {
    if (item.fields.ReemplazaSolicitudId) replacedIds.add(Number(item.fields.ReemplazaSolicitudId));
  });
  return replacedIds;
}

/**
 * Ids (Number) de las sugerencias automáticas (arrastre de las 18:05) de un día en que el cliente SÍ envió su
 * solicitud para ese contrato. Esas sugerencias no cuentan (el ERP las deja en el historial: requestStatus.ts),
 * así que el portal no se las muestra al cliente, ni siquiera como historial.
 */
function supersededSuggestionIds(items) {
  const keyOf = (f) => `${f.ClienteId}|${f.ContratoId == null ? '' : f.ContratoId}|${String(f.FechaServicio || '').slice(0, 10)}`;
  const daysWithClientRequest = new Set();
  items.forEach((item) => {
    const f = item.fields;
    const confirmedProjection = f.OrigenSolicitud === 'Proyección automática' && f.EstadoSolicitud === 'Oficial';
    if (f.EstadoSolicitud !== 'Arrastre automático' && f.EstadoSolicitud !== 'Anulada' && !confirmedProjection) daysWithClientRequest.add(keyOf(f));
  });
  const ids = new Set();
  items.forEach((item) => {
    if (item.fields.EstadoSolicitud === 'Arrastre automático' && daysWithClientRequest.has(keyOf(item.fields))) ids.add(Number(item.id));
  });
  return ids;
}

module.exports = { displayStatus, computeReplacedIds, supersededSuggestionIds };
