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

module.exports = { displayStatus, computeReplacedIds };
