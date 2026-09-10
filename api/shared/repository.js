const { getListItems, getListItemById, createListItem } = require('./graph');

const LISTS = {
  channels: 'ICH_CANALES_SOLICITUDES',
  clients: 'ICH_CLIENTES',
  contracts: 'ICH_CONTRATOS',
  contractRates: 'ICH_CONTRATOS_TARIFAS',
  serviceRequests: 'ICH_SOLICITUDES_SERVICIO',
  rejectedAttempts: 'ICH_SOLICITUDES_RECHAZADAS'
};

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
  // Graph espera true/false para Boolean, no 1/0 como el REST clasico de SharePoint (eso causaba un 400).
  const items = await getListItems(LISTS.contractRates, `filter=fields/ContratoId eq ${contratoId} and fields/Activo eq true&top=500`);
  return Array.from(new Set(items.map((item) => item.fields.TipoServicio)));
}

/** La solicitud OFICIAL vigente hoy para esa fecha/servicio, si existe (no cuenta 'Extraordinaria pendiente' — igual que en el ERP). */
async function findOfficialRequest(contratoId, fechaServicio, tipoServicio) {
  const items = await getListItems(
    LISTS.serviceRequests,
    `filter=fields/ContratoId eq ${contratoId} and fields/FechaServicio eq ${fechaServicio} and fields/TipoServicio eq '${tipoServicio}' and fields/EstadoSolicitud eq 'Oficial'&top=1`
  );
  return items[0];
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
  const since = new Date(Date.now() - minutesWindow * 60 * 1000).toISOString();
  // Graph espera valores DateTime sin comillas en el filtro (formato ISO 8601 plano).
  const [accepted, rejected] = await Promise.all([
    getListItems(LISTS.serviceRequests, `filter=fields/CodigoCanal eq '${codigoCanal}' and fields/FechaRecepcion ge ${since}&top=200`),
    getListItems(LISTS.rejectedAttempts, `filter=fields/CanalId eq ${canalId} and fields/FechaRecepcion ge ${since}&top=200`)
  ]);
  return accepted.length + rejected.length;
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
  countRecentAttempts
};
