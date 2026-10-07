const { getListItems, getListItemById, createListItem, updateListItem } = require('./graph');

const LISTS = {
  channels: 'ICH_CANALES_SOLICITUDES',
  clients: 'ICH_CLIENTES',
  contracts: 'ICH_CONTRATOS',
  contractRates: 'ICH_CONTRATOS_TARIFAS',
  serviceRequests: 'ICH_SOLICITUDES_SERVICIO',
  rejectedAttempts: 'ICH_SOLICITUDES_RECHAZADAS',
  incidentChannels: 'ICH_CANALES_INCIDENCIAS',
  establishments: 'ICH_ESTABLECIMIENTOS',
  workOrders: 'ICH_INCIDENCIAS'
};

async function listActiveChannels() {
  const items = await getListItems(LISTS.channels, `top=500`);
  return items.filter((item) => item.fields.Estado === 'Activo');
}

function getContract(contratoId) {
  return getListItemById(LISTS.contracts, contratoId);
}

/** Ultima cantidad OFICIAL valida para ese servicio, en una fecha anterior a la indicada (nunca inventa un valor). */
async function getLastOfficialQuantityBefore(contratoId, tipoServicio, beforeDateIso) {
  const items = await getListItems(
    LISTS.serviceRequests,
    `filter=fields/ContratoId eq ${contratoId} and fields/TipoServicio eq '${tipoServicio}' and fields/EstadoSolicitud eq 'Oficial'&top=500`
  );
  const prior = items
    .filter((item) => (item.fields.FechaServicio || '').slice(0, 10) < beforeDateIso)
    .sort((a, b) => (a.fields.FechaServicio < b.fields.FechaServicio ? 1 : -1));
  return prior[0] ? prior[0].fields.CantidadOficial : undefined;
}

async function hasOfficialRequestForDate(contratoId, tipoServicio, fechaIso) {
  const items = await getListItems(
    LISTS.serviceRequests,
    `filter=fields/ContratoId eq ${contratoId} and fields/TipoServicio eq '${tipoServicio}' and fields/EstadoSolicitud eq 'Oficial'&top=500`
  );
  return items.some((item) => (item.fields.FechaServicio || '').slice(0, 10) === fechaIso);
}

/** Solo Colación: si ESE horario específico ya tiene una solicitud oficial para esa fecha —
 * el resto de los horarios del mismo día puede seguir faltando y arrastrarse aparte. */
async function hasOfficialRequestForDateAndHorario(contratoId, tipoServicio, horario, fechaIso) {
  const items = await getListItems(
    LISTS.serviceRequests,
    `filter=fields/ContratoId eq ${contratoId} and fields/TipoServicio eq '${tipoServicio}' and fields/EstadoSolicitud eq 'Oficial'&top=500`
  );
  return items.some((item) => (item.fields.FechaServicio || '').slice(0, 10) === fechaIso
    && (item.fields.HoraServicio || '') === (horario || ''));
}

/** Solo Colación: todos los bloques 'Oficial' (uno por horario) del día válido anterior más
 * reciente antes de beforeDateIso — nunca mezcla bloques de días distintos entre sí. */
async function getLastOfficialColacionBlocksBefore(contratoId, tipoServicio, beforeDateIso) {
  const items = await getListItems(
    LISTS.serviceRequests,
    `filter=fields/ContratoId eq ${contratoId} and fields/TipoServicio eq '${tipoServicio}' and fields/EstadoSolicitud eq 'Oficial'&top=500`
  );
  const prior = items.filter((item) => (item.fields.FechaServicio || '').slice(0, 10) < beforeDateIso);
  if (prior.length === 0) return [];
  const latestDate = prior.reduce((max, item) => {
    const date = (item.fields.FechaServicio || '').slice(0, 10);
    return date > max ? date : max;
  }, '');
  return prior.filter((item) => (item.fields.FechaServicio || '').slice(0, 10) === latestDate);
}

async function getContractServiceLabel(contratoId) {
  const item = await getListItemById(LISTS.contracts, contratoId);
  return item && item.fields.ContratoServicio;
}

async function findChannelByTokenHash(tokenHash) {
  const items = await getListItems(LISTS.channels, `filter=fields/TokenHash eq '${tokenHash}'&top=1`);
  return items[0];
}

/** Para re-resolver el canal desde una sesion (que solo trae el CanalId) — nunca desde datos del navegador. */
function getChannelById(canalId) {
  return getListItemById(LISTS.channels, canalId);
}

function updateChannelPinState(canalId, fields) {
  return updateListItem(LISTS.channels, canalId, fields);
}

/** Ultimos N dias de solicitudes de un contrato, para "Mis solicitudes" — nunca de otro contrato. */
async function listRecentServiceRequests(contratoId, sinceDateIso) {
  const items = await getListItems(LISTS.serviceRequests, `filter=fields/ContratoId eq ${contratoId}&top=1000`);
  return items.filter((item) => (item.fields.FechaServicio || '').slice(0, 10) >= sinceDateIso);
}

async function getClientName(clienteId) {
  const item = await getListItemById(LISTS.clients, clienteId);
  return item && item.fields.RazonSocial;
}

/** TipoServicio de las tarifas ACTIVAS del contrato — es la fuente real de "qué está contratado", no una fotografía guardada en el canal. */
async function getActiveContractServiceTypes(contratoId) {
  // Activo se filtra en JS, no en el OData de Graph: evita la ambiguedad de si un Yes/No
  // de SharePoint se representa como true/false o 1/0 al filtrar via Graph.
  const items = await getListItems(LISTS.contractRates, `filter=fields/ContratoId eq ${contratoId}&top=500`);
  return Array.from(new Set(items.filter((item) => item.fields.Activo).map((item) => item.fields.TipoServicio)));
}

/** La solicitud OFICIAL vigente hoy para esa fecha/servicio, si existe (no cuenta 'Extraordinaria pendiente' — igual que en el ERP). */
async function findOfficialRequest(contratoId, fechaServicio, tipoServicio) {
  const items = await getListItems(
    LISTS.serviceRequests,
    `filter=fields/ContratoId eq ${contratoId} and fields/TipoServicio eq '${tipoServicio}' and fields/EstadoSolicitud eq 'Oficial'&top=200`
  );
  return items.find((item) => (item.fields.FechaServicio || '').slice(0, 10) === fechaServicio);
}

async function findByClaveFila(claveFila) {
  const items = await getListItems(LISTS.serviceRequests, `filter=fields/ClaveFila eq '${claveFila}'&top=1`);
  return items[0];
}

/**
 * Para un reemplazo: la solicitud más reciente (cualquier estado salvo Anulada) para esa
 * fecha/servicio(/horario) del contrato — a la que ReemplazaSolicitudId debe apuntar. Nunca se
 * edita ni se borra; solo se usa para enlazar el historial.
 *
 * horario: solo relevante para Colación — sin esto, un reemplazo de UN bloque horario
 * encontraría (y "reemplazaría" en el historial) cualquier bloque del día, no el suyo.
 */
async function findLatestRequestForReplacement(contratoId, tipoServicio, fechaServicio, horario) {
  const items = await getListItems(
    LISTS.serviceRequests,
    `filter=fields/ContratoId eq ${contratoId} and fields/TipoServicio eq '${tipoServicio}'&top=500`
  );
  const candidates = items.filter((item) => (item.fields.FechaServicio || '').slice(0, 10) === fechaServicio
    && item.fields.EstadoSolicitud !== 'Anulada'
    && (item.fields.HoraServicio || '') === (horario || ''));
  candidates.sort((a, b) => (b.fields.FechaRecepcion || '').localeCompare(a.fields.FechaRecepcion || ''));
  return candidates[0];
}

/** Todas las solicitudes de un servicio del contrato — el plan por plantilla busca los reemplazos en memoria, no una consulta por fila. */
async function listContractServiceRequests(contratoId, tipoServicio) {
  return getListItems(LISTS.serviceRequests, `filter=fields/ContratoId eq ${contratoId} and fields/TipoServicio eq '${tipoServicio}'&top=500`);
}

async function createServiceRequest(fields) {
  return createListItem(LISTS.serviceRequests, fields);
}

async function logRejectedAttempt(canalId, codigoCanal, motivoRechazo) {
  await createListItem(LISTS.rejectedAttempts, {
    Title: `${codigoCanal} · ${motivoRechazo}`,
    CanalId: canalId,
    CodigoCanal: codigoCanal,
    MotivoRechazo: motivoRechazo,
    FechaRecepcion: new Date().toISOString()
  });
}

/**
 * Límite de intentos — corregido: se cuenta por CanalId/CodigoCanal, no por TokenHash,
 * porque las filas aceptadas en ICH_SOLICITUDES_SERVICIO no guardan el hash del token.
 */
async function countRecentAttempts(canalId, codigoCanal, minutesWindow) {
  // La fecha se filtra en JS, no en el OData de Graph — el filtro de fecha ahi dio
  // "Invalid request" sin mas detalle; para el volumen real de este canal (unas pocas
  // filas por ventana de minutos) traer todo por CodigoCanal/CanalId y filtrar es simple y robusto.
  const sinceMs = Date.now() - minutesWindow * 60 * 1000;
  const [accepted, rejected] = await Promise.all([
    getListItems(LISTS.serviceRequests, `filter=fields/CodigoCanal eq '${codigoCanal}'&top=200`),
    getListItems(LISTS.rejectedAttempts, `filter=fields/CanalId eq ${canalId}&top=200`)
  ]);
  const recent = (items) => items.filter((item) => new Date(item.fields.FechaRecepcion).getTime() >= sinceMs);
  // Un envío cuenta una vez aunque escriba muchas filas (un plan por plantilla trae decenas).
  const submissions = new Set(recent(accepted).map((item) => item.fields.SubmissionId || `id:${item.id}`));
  return submissions.size + recent(rejected).length;
}

/** Canal de incidencias por establecimiento — mismo patrón que findChannelByTokenHash, lista separada. */
async function findIncidentChannelByTokenHash(tokenHash) {
  const items = await getListItems(LISTS.incidentChannels, `filter=fields/TokenHash eq '${tokenHash}'&top=1`);
  return items[0];
}

async function getEstablishmentName(establecimientoId) {
  const item = await getListItemById(LISTS.establishments, establecimientoId);
  return item && item.fields.Title;
}

function createIncidentReport(fields) {
  return createListItem(LISTS.workOrders, fields);
}

/** Igual que countRecentAttempts pero contra ICH_INCIDENCIAS en vez de ICH_SOLICITUDES_SERVICIO — mismo CanalId/CodigoCanal, misma lista de rechazados compartida. */
async function countRecentIncidentAttempts(canalId, codigoCanal, minutesWindow) {
  const sinceMs = Date.now() - minutesWindow * 60 * 1000;
  const [accepted, rejected] = await Promise.all([
    getListItems(LISTS.workOrders, `filter=fields/CodigoCanal eq '${codigoCanal}'&top=200`),
    getListItems(LISTS.rejectedAttempts, `filter=fields/CanalId eq ${canalId}&top=200`)
  ]);
  // Si no viene Created/FechaRecepcion en la respuesta de Graph, se cuenta como reciente
  // (conservador para un límite de intentos: mejor sobre-contar que dejar pasar un abuso).
  const recent = (items) => items.filter((item) => {
    const stamp = item.fields.FechaRecepcion || item.fields.Created;
    const ms = stamp ? new Date(stamp).getTime() : NaN;
    return Number.isNaN(ms) || ms >= sinceMs;
  });
  return recent(accepted).length + recent(rejected).length;
}

module.exports = {
  findChannelByTokenHash,
  getChannelById,
  updateChannelPinState,
  listRecentServiceRequests,
  getClientName,
  getContractServiceLabel,
  getActiveContractServiceTypes,
  findOfficialRequest,
  findByClaveFila,
  findLatestRequestForReplacement,
  createServiceRequest,
  listContractServiceRequests,
  logRejectedAttempt,
  countRecentAttempts,
  listActiveChannels,
  getContract,
  getLastOfficialQuantityBefore,
  hasOfficialRequestForDate,
  hasOfficialRequestForDateAndHorario,
  getLastOfficialColacionBlocksBefore,
  findIncidentChannelByTokenHash,
  getEstablishmentName,
  createIncidentReport,
  countRecentIncidentAttempts
};
