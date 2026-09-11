const { getListItems, getListItemById, createListItem } = require('./graph');

const LISTS = {
  channels: 'ICH_CANALES_SOLICITUDES',
  clients: 'ICH_CLIENTES',
  contracts: 'ICH_CONTRATOS',
  contractRates: 'ICH_CONTRATOS_TARIFAS',
  serviceRequests: 'ICH_SOLICITUDES_SERVICIO',
  rejectedAttempts: 'ICH_SOLICITUDES_RECHAZADAS'
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

async function getContractServiceLabel(contratoId) {
  const item = await getListItemById(LISTS.contracts, contratoId);
  return item && item.fields.ContratoServicio;
}

async function findChannelByTokenHash(tokenHash) {
  const items = await getListItems(LISTS.channels, `filter=fields/TokenHash eq '${tokenHash}'&top=1`);
  return items[0];
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
  return recent(accepted).length + recent(rejected).length;
}

module.exports = {
  findChannelByTokenHash,
  getClientName,
  getContractServiceLabel,
  getActiveContractServiceTypes,
  findOfficialRequest,
  findByClaveFila,
  createServiceRequest,
  logRejectedAttempt,
  countRecentAttempts,
  listActiveChannels,
  getContract,
  getLastOfficialQuantityBefore,
  hasOfficialRequestForDate
};
