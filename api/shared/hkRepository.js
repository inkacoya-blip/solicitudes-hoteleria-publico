/**
 * Acceso a SharePoint (vía Graph, solo desde el servidor) para la app del celular de hospedaje.
 * Las consultas filtran por columnas numéricas/indexadas (EstablecimientoId, Dia, Clave): los filtros
 * de fecha de Graph han fallado con «Invalid request», por eso el parte guarda además el día como AAAAMMDD.
 */
const { getListItems, getListItemById, createListItem, updateListItem } = require('./graph');
const { getContract, getClientName, getEstablishmentName } = require('./repository');

const LISTS = {
  staff: 'ICH_PERSONAL_HOSPEDAJE',
  rooms: 'ICH_PIEZAS',
  daily: 'ICH_PARTE_PIEZA',
  changes: 'ICH_PARTE_CAMBIOS',
  closures: 'ICH_CIERRE_CASA',
  establishments: 'ICH_ESTABLECIMIENTOS',
  contractLinks: 'ICH_CONTRATOS_ESTABLECIMIENTOS',
  incidents: 'ICH_INCIDENCIAS',
  supplies: 'ICH_SOLICITUDES_INSUMOS',
  bpmFormats: 'ICH_BPM_FORMATOS',
  bpmRecords: 'ICH_BPM_REGISTROS'
};

const num = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Identificador no válido.');
  return n;
};

/** El código solo se usa en un filtro OData: se valida el formato aparte, esto es la segunda barrera. */
const safeText = (value) => String(value).replace(/'/g, "''");

async function findStaffByCode(code) {
  const items = await getListItems(LISTS.staff, `filter=fields/Codigo eq '${safeText(code)}'&top=1`);
  return items[0];
}

function getStaffById(id) {
  return getListItemById(LISTS.staff, num(id));
}

function updateStaff(id, fields) {
  return updateListItem(LISTS.staff, num(id), fields);
}

async function listActiveHouses() {
  const [houses, rooms] = await Promise.all([
    getListItems(LISTS.establishments, 'top=200'),
    getListItems(LISTS.rooms, 'top=999')
  ]);
  const withRooms = new Set(rooms.filter((room) => room.fields.Activo).map((room) => Number(room.fields.EstablecimientoId)));
  return houses.filter((house) => house.fields.Activo && withRooms.has(Number(house.id)));
}

function getHouse(id) {
  return getListItemById(LISTS.establishments, num(id));
}

function listRoomsOfHouse(houseId) {
  return getListItems(LISTS.rooms, `filter=fields/EstablecimientoId eq ${num(houseId)}&top=500`);
}

function listDailyByDay(houseId, dia) {
  return getListItems(LISTS.daily, `filter=fields/EstablecimientoId eq ${num(houseId)} and fields/Dia eq ${num(dia)}&top=500`);
}

function listDailyBetween(houseId, fromDia, beforeDia) {
  return getListItems(LISTS.daily, `filter=fields/EstablecimientoId eq ${num(houseId)} and fields/Dia ge ${num(fromDia)} and fields/Dia lt ${num(beforeDia)}&top=999`);
}

function getDaily(id) {
  return getListItemById(LISTS.daily, num(id));
}

function createDaily(fields) {
  return createListItem(LISTS.daily, fields);
}

function updateDaily(id, fields) {
  return updateListItem(LISTS.daily, num(id), fields);
}

function createChange(fields) {
  return createListItem(LISTS.changes, fields);
}

async function findClosure(houseId, fecha) {
  const items = await getListItems(LISTS.closures, `filter=fields/Clave eq '${safeText(`${fecha}|${num(houseId)}`)}'&top=1`);
  return items[0];
}

function createClosure(fields) {
  return createListItem(LISTS.closures, fields);
}

function updateClosure(id, fields) {
  return updateListItem(LISTS.closures, num(id), fields);
}

function listContractLinks(houseId) {
  return getListItems(LISTS.contractLinks, `filter=fields/EstablecimientoId eq ${num(houseId)}&top=200`);
}

function listPendingDamages(houseId) {
  return getListItems(LISTS.incidents, `filter=fields/EstablecimientoId eq ${num(houseId)} and fields/ConfirmacionDano eq 'Por confirmar'&top=100`);
}

function getIncident(id) {
  return getListItemById(LISTS.incidents, num(id));
}

function updateIncident(id, fields) {
  return updateListItem(LISTS.incidents, num(id), fields);
}

function createIncident(fields) {
  return createListItem(LISTS.incidents, fields);
}

function createSupplyRequest(fields) {
  return createListItem(LISTS.supplies, fields);
}

function listSupplyRequests(houseId) {
  return getListItems(LISTS.supplies, `filter=fields/EstablecimientoId eq ${num(houseId)}&top=200`);
}

function listBpmFormats() {
  return getListItems(LISTS.bpmFormats, 'top=200');
}

function listBpmRecordsByDay(dia) {
  return getListItems(LISTS.bpmRecords, `filter=fields/Dia eq ${num(dia)}&top=999`);
}

function createBpmRecord(fields) {
  return createListItem(LISTS.bpmRecords, fields);
}

module.exports = {
  LISTS,
  listBpmFormats,
  listBpmRecordsByDay,
  createBpmRecord,
  findStaffByCode,
  getStaffById,
  updateStaff,
  listActiveHouses,
  getHouse,
  listRoomsOfHouse,
  listDailyByDay,
  listDailyBetween,
  getDaily,
  createDaily,
  updateDaily,
  createChange,
  findClosure,
  createClosure,
  updateClosure,
  listContractLinks,
  listPendingDamages,
  getIncident,
  updateIncident,
  createIncident,
  createSupplyRequest,
  listSupplyRequests,
  getContract,
  getClientName,
  getEstablishmentName
};
