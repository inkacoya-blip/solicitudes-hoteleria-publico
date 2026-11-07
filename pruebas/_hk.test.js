const assert = require('assert');
process.env.PORTAL_SESSION_SECRET = 'clave-de-prueba-no-real';
const { hashPin } = require('../api/shared/hash');
const { createHandlers } = require('../api/shared/hkHandlers');

const SALT_CAM = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
const SALT_SUP = 'f1e2d3c4b5a6f1e2d3c4b5a6f1e2d3c4';
let nextId = 100;
const db = {
  staff: [
    { id: '1', fields: { Title: 'Ana Pérez', Codigo: 'CAM-001', Rol: 'Camarera', Activo: true, PinSalt: SALT_CAM, PinHash: hashPin('482913', SALT_CAM), PinIntentosFallidos: 0 } },
    { id: '2', fields: { Title: 'Sofía Rojas', Codigo: 'SUP-001', Rol: 'Supervisora', Activo: true, PinSalt: SALT_SUP, PinHash: hashPin('715384', SALT_SUP), PinIntentosFallidos: 0 } }
  ],
  houses: [{ id: '11', fields: { Title: 'Hostal 11', Activo: true } }, { id: '99', fields: { Title: 'Hostal vacío', Activo: true } }],
  rooms: [
    { id: '501', fields: { Title: '10', EstablecimientoId: 11, Camas: 2, Activo: true } },
    { id: '502', fields: { Title: '2', EstablecimientoId: 11, Camas: 2, Activo: true } },
    { id: '503', fields: { Title: '3', EstablecimientoId: 11, Camas: 1, Activo: false } },
    { id: '600', fields: { Title: '1', EstablecimientoId: 4, Camas: 2, Activo: true } }
  ],
  daily: [], changes: [], closures: [], incidents: [], supplies: [], uploads: [],
  links: [
    { fields: { ContratoId: 7, EstablecimientoId: 11, FechaDesde: '2026-01-01T00:00:00Z' } },
    { fields: { ContratoId: 12, EstablecimientoId: 11, FechaDesde: '2026-01-01T00:00:00Z' } },
    { fields: { ContratoId: 40, EstablecimientoId: 11, FechaDesde: '2026-01-01T00:00:00Z', FechaHasta: '2026-03-01T00:00:00Z' } }
  ],
  contracts: {
    7: { fields: { ClienteId: 1, NumeroContrato: 'C-7', Estado: 'Vigente' } },
    12: { fields: { ClienteId: 2, NumeroContrato: 'C-12', Estado: 'Pendiente de firma' } },
    40: { fields: { ClienteId: 3, NumeroContrato: 'C-40', Estado: 'Vigente' } }
  },
  clients: { 1: 'Mecamin', 2: 'EVH Ingeniería', 3: 'Vencido SpA' }
};
const duplicate = () => Object.assign(new Error('dup'), { detail: 'The list item already has the value' });
const repo = {
  findStaffByCode: async (code) => db.staff.find((p) => p.fields.Codigo === code),
  getStaffById: async (id) => db.staff.find((p) => p.id === String(id)),
  updateStaff: async (id, fields) => { Object.assign(db.staff.find((p) => p.id === String(id)).fields, fields); },
  listActiveHouses: async () => db.houses.filter((h) => db.rooms.some((r) => r.fields.EstablecimientoId === Number(h.id) && r.fields.Activo)),
  getHouse: async (id) => db.houses.find((h) => h.id === String(id)),
  listRoomsOfHouse: async (id) => db.rooms.filter((r) => r.fields.EstablecimientoId === Number(id)),
  listDailyByDay: async (house, dia) => db.daily.filter((d) => d.fields.EstablecimientoId === house && d.fields.Dia === dia),
  listDailyBetween: async (house, from, before) => db.daily.filter((d) => d.fields.EstablecimientoId === house && d.fields.Dia >= from && d.fields.Dia < before),
  getDaily: async (id) => db.daily.find((d) => d.id === String(id)),
  createDaily: async (fields) => {
    if (db.daily.some((d) => d.fields.Clave === fields.Clave)) throw duplicate();
    const item = { id: String(++nextId), fields: { ...fields } };
    db.daily.push(item);
    return item;
  },
  updateDaily: async (id, fields) => { Object.assign(db.daily.find((d) => d.id === String(id)).fields, fields); },
  createChange: async (fields) => { db.changes.push(fields); },
  findClosure: async (house, fecha) => db.closures.find((c) => c.fields.Clave === `${fecha}|${house}`),
  createClosure: async (fields) => { db.closures.push({ id: String(++nextId), fields: { ...fields } }); },
  updateClosure: async (id, fields) => { Object.assign(db.closures.find((c) => c.id === String(id)).fields, fields); },
  listContractLinks: async (house) => db.links.filter((l) => l.fields.EstablecimientoId === Number(house)),
  listPendingDamages: async (house) => db.incidents.filter((i) => i.fields.EstablecimientoId === Number(house) && i.fields.ConfirmacionDano === 'Por confirmar'),
  getIncident: async (id) => db.incidents.find((i) => i.id === String(id)),
  updateIncident: async (id, fields) => { Object.assign(db.incidents.find((i) => i.id === String(id)).fields, fields); },
  createIncident: async (fields) => {
    if (db.incidents.some((i) => i.fields.SubmissionId === fields.SubmissionId)) throw duplicate();
    const item = { id: String(++nextId), fields: { ...fields } };
    db.incidents.push(item);
    return item;
  },
  createSupplyRequest: async (fields) => {
    if (db.supplies.some((s) => s.fields.SubmissionId === fields.SubmissionId)) throw duplicate();
    db.supplies.push({ id: String(++nextId), fields: { ...fields } });
  },
  listSupplyRequests: async (house) => db.supplies.filter((s) => s.fields.EstablecimientoId === Number(house)),
  getContract: async (id) => db.contracts[id],
  getClientName: async (id) => db.clients[id],
  getEstablishmentName: async (id) => (db.houses.find((h) => h.id === String(id)) || {}).fields.Title
};

let nowIso = '2026-11-05T15:00:00Z'; // 12:00 en Chile
const handlers = createHandlers({ repo, uploadFile: async (path) => { db.uploads.push(path); return `https://sp/${path}`; }, now: () => new Date(nowIso) });
const TODAY = '2026-11-05';

(async () => {
  // --- Login
  const bad = await handlers.login({ codigo: 'CAM-001', pin: '000000' });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual((await handlers.login({ codigo: 'NOEXISTE', pin: '482913' })).message, bad.message, 'mismo mensaje exista o no el código');
  assert.strictEqual((await handlers.login({ codigo: 'CAM-999', pin: '482913' })).message, bad.message);
  for (let i = 0; i < 4; i += 1) await handlers.login({ codigo: 'CAM-001', pin: '111111' });
  const locked = await handlers.login({ codigo: 'CAM-001', pin: '482913' });
  assert.strictEqual(locked.ok, false, 'tras 5 fallos queda bloqueada aunque ahora ponga el PIN bueno');
  assert.ok(/Demasiados intentos/.test(locked.message));
  nowIso = '2026-11-05T15:20:00Z'; // pasan 20 min
  const cam = await handlers.login({ codigo: ' cam-001 ', pin: '482913' });
  assert.strictEqual(cam.ok, true, 'pasado el bloqueo entra (y acepta minúsculas/espacios en el código)');
  assert.strictEqual(db.staff[0].fields.PinIntentosFallidos, 0);
  const sup = await handlers.login({ codigo: 'SUP-001', pin: '715384' });
  assert.strictEqual(sup.persona.supervision, true);
  const camToken = cam.sessionToken;
  const supToken = sup.sessionToken;

  // --- Sesión
  assert.strictEqual((await handlers.houses({ sessionToken: 'basura' })).sessionExpired, true);
  assert.strictEqual((await handlers.houses({ sessionToken: camToken })).casas.length, 1, 'solo casas con piezas');

  // --- Casa: orden natural, solo piezas activas, contratos vigentes ese día
  const house = await handlers.house({ sessionToken: camToken, casaId: 11 });
  assert.strictEqual(house.ok, true);
  assert.deepStrictEqual(house.piezas.map((p) => p.numero), ['2', '10'], 'orden natural y sin desactivadas');
  assert.deepStrictEqual(house.contratos.map((c) => c.empresa), ['EVH Ingeniería', 'Mecamin'], 'sin contratos vencidos; incluye pendiente de firma');
  assert.strictEqual(house.cerrado, null);
  assert.strictEqual((await handlers.house({ sessionToken: camToken, casaId: 12345 })).ok, false);

  // --- Guardar partes
  const day = (extra) => ({ sessionToken: camToken, casaId: 11, fecha: TODAY, ...extra });
  const r1 = await handlers.saveRooms(day({ piezas: [
    { piezaId: 502, ocupacion: 'Ocupada', contratoId: 7, personas: 2, camas: 2, limpiezaDiaria: true, sinDanos: true },
    { piezaId: 501, ocupacion: 'Vacía' }
  ] }));
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(db.daily.length, 2);
  assert.strictEqual(db.daily[0].fields.Clave, `${TODAY}|502`);
  assert.strictEqual(db.daily[0].fields.Dia, 20261105);
  assert.strictEqual(db.daily[0].fields.RegistradoPor, 'CAM-001 · Ana Pérez');
  const bad2 = await handlers.saveRooms(day({ piezas: [{ piezaId: 502, ocupacion: 'Ocupada', contratoId: 40, personas: 1, camas: 1 }] }));
  assert.strictEqual(bad2.ok, false, 'contrato vencido no se puede elegir');
  assert.strictEqual((await handlers.saveRooms(day({ piezas: [{ piezaId: 600, ocupacion: 'Vacía' }] }))).ok, false, 'pieza de otra casa');
  assert.strictEqual((await handlers.saveRooms(day({ piezas: [{ piezaId: 503, ocupacion: 'Vacía' }] }))).ok, false, 'pieza desactivada');
  assert.strictEqual((await handlers.saveRooms(day({ fecha: '2026-11-01', piezas: [{ piezaId: 501, ocupacion: 'Vacía' }] }))).ok, false, 'camarera no corrige días viejos');

  // Reenviar lo mismo no ensucia la bitácora; cambiar algo sí la anota
  const changesBefore = db.changes.length;
  await handlers.saveRooms(day({ piezas: [{ piezaId: 502, ocupacion: 'Ocupada', contratoId: 7, personas: 2, camas: 2, limpiezaDiaria: true, sinDanos: true }] }));
  assert.strictEqual(db.changes.length, changesBefore, 'sin cambios no hay registro');
  await handlers.saveRooms({ ...day({}), sessionToken: supToken, piezas: [{ piezaId: 502, ocupacion: 'Ocupada', contratoId: 12, personas: 1, camas: 1, limpiezaDiaria: true, sinDanos: true }] });
  const added = db.changes.slice(changesBefore);
  assert.ok(added.length >= 3, 'contrato, personas y camas cambiaron');
  assert.ok(added.every((c) => c.Persona === 'SUP-001 · Sofía Rojas'), 'queda quién lo cambió');
  assert.strictEqual(db.daily[0].fields.ModificadoPor, 'SUP-001 · Sofía Rojas');
  assert.strictEqual(db.daily[0].fields.RegistradoPor, 'CAM-001 · Ana Pérez', 'el que registró primero no se pisa');

  // Guardado simultáneo (la clave única ya existe aunque la lectura no la vio)
  const original = repo.listDailyByDay;
  let first = true;
  repo.listDailyByDay = async (...args) => { if (first) { first = false; return []; } return original(...args); };
  const dupe = await handlers.saveRooms(day({ piezas: [{ piezaId: 501, ocupacion: 'Ocupada', contratoId: 7, personas: 1, camas: 1 }] }));
  repo.listDailyByDay = original;
  assert.strictEqual(dupe.ok, true, 'conflicto de clave única se resuelve como edición');
  assert.strictEqual(db.daily.filter((d) => d.fields.PiezaId === 501).length, 1, 'no se duplica');

  // --- Sugerencia desde el día anterior
  nowIso = '2026-11-06T15:00:00Z';
  const tomorrow = await handlers.house({ sessionToken: (await handlers.login({ codigo: 'CAM-001', pin: '482913' })).sessionToken, casaId: 11 });
  const p502 = tomorrow.piezas.find((p) => p.numero === '2');
  assert.strictEqual(p502.parte, undefined, 'lo de ayer no es lo de hoy');
  assert.deepStrictEqual(p502.sugerido, { ocupacion: 'Ocupada', contratoId: 12, personas: 1, camas: 1 });
  nowIso = '2026-11-05T15:30:00Z';

  // --- Cierre del día
  assert.strictEqual((await handlers.closeDay(day({}))).ok, false, 'camarera no cierra');
  const early = await handlers.closeDay({ ...day({}), sessionToken: supToken });
  assert.strictEqual(early.ok, true, 'las dos piezas activas ya tienen parte');
  assert.strictEqual((await handlers.closeDay({ ...day({}), sessionToken: supToken })).ok, false, 'ya cerrado');
  const closedSave = await handlers.saveRooms(day({ piezas: [{ piezaId: 501, ocupacion: 'Vacía' }] }));
  assert.strictEqual(closedSave.ok, false, 'día cerrado no se edita');
  assert.deepStrictEqual((await handlers.house({ sessionToken: camToken, casaId: 11 })).cerrado.por, 'SUP-001 · Sofía Rojas');
  assert.strictEqual((await handlers.reopenDay({ ...day({}), sessionToken: supToken, motivo: 'x' })).ok, false, 'reabrir exige motivo');
  assert.strictEqual((await handlers.reopenDay({ ...day({}), sessionToken: supToken, motivo: 'Se corrigió una empresa' })).ok, true);
  assert.strictEqual((await handlers.saveRooms(day({ piezas: [{ piezaId: 501, ocupacion: 'Vacía' }] }))).ok, true, 'reabierto se edita de nuevo');
  assert.strictEqual((await handlers.closeDay({ ...day({}), sessionToken: supToken })).ok, true, 'se puede volver a cerrar');
  assert.strictEqual(db.closures.length, 1, 'un solo registro de cierre por casa y día');

  // Cierre con piezas faltantes
  db.rooms.push({ id: '504', fields: { Title: '11', EstablecimientoId: 11, Camas: 2, Activo: true } });
  await handlers.reopenDay({ ...day({}), sessionToken: supToken, motivo: 'Agregan pieza 11' });
  const missing = await handlers.closeDay({ ...day({}), sessionToken: supToken });
  assert.strictEqual(missing.ok, false);
  assert.deepStrictEqual(missing.faltan, ['11']);
  await handlers.saveRooms(day({ piezas: [{ piezaId: 504, ocupacion: 'Vacía' }] }));

  // --- Revisión
  const rev = await handlers.reviewRoom({ ...day({}), sessionToken: supToken, piezaId: 502, resultado: 'Observada', nota: 'Falta bajo la cama' });
  assert.strictEqual(rev.ok, true);
  assert.strictEqual(db.daily.find((d) => d.fields.PiezaId === 502).fields.RevisionResultado, 'Observada');
  assert.strictEqual((await handlers.reviewRoom({ ...day({}), piezaId: 502, resultado: 'Conforme' })).ok, false, 'camarera no revisa');
  assert.strictEqual((await handlers.reviewRoom({ ...day({}), sessionToken: supToken, piezaId: 502, resultado: 'Observada' })).ok, false, 'observada exige nota');

  // --- Daños
  const desgaste = await handlers.reportDamage(day({ piezaId: 502, tipo: 'Desgaste', descripcion: 'Velador flojo', submissionId: 'd-1' }));
  assert.strictEqual(desgaste.ok, true);
  assert.strictEqual(db.incidents[0].fields.EstadoCobro, 'No aplica');
  assert.strictEqual(db.incidents[0].fields.ConfirmacionDano, undefined);
  const sinFoto = await handlers.reportDamage(day({ piezaId: 502, tipo: 'Posible mal uso', descripcion: 'Colchón quemado', submissionId: 'd-2' }));
  assert.strictEqual(sinFoto.ok, false, 'mal uso sin foto no se acepta');
  const foto = Buffer.from('foto').toString('base64');
  const malUso = await handlers.reportDamage(day({ piezaId: 502, tipo: 'Posible mal uso', descripcion: 'Colchón quemado', submissionId: 'd-2', fotoBase64: foto }));
  assert.strictEqual(malUso.ok, true);
  assert.strictEqual(db.incidents[1].fields.ConfirmacionDano, 'Por confirmar');
  assert.strictEqual(db.incidents[1].fields.ContratoId, 12, 'queda el contrato que ocupaba la pieza ese día');
  assert.strictEqual(db.incidents[1].fields.Prioridad, 'Alta');
  assert.ok(db.uploads[0].startsWith('DanosFotos/11/'));
  await handlers.reportDamage(day({ piezaId: 502, tipo: 'Posible mal uso', descripcion: 'Colchón quemado', submissionId: 'd-2', fotoBase64: foto }));
  assert.strictEqual(db.incidents.length, 2, 'doble toque no duplica');
  const pending = await handlers.house({ sessionToken: supToken, casaId: 11 });
  assert.strictEqual(pending.danosPorConfirmar.length, 1);
  assert.strictEqual((await handlers.house({ sessionToken: camToken, casaId: 11 })).danosPorConfirmar.length, 0, 'la camarera no ve la lista de confirmación');
  assert.strictEqual((await handlers.decideDamage({ sessionToken: camToken, incidenteId: db.incidents[1].id, decision: 'mal-uso' })).ok, false);
  const decided = await handlers.decideDamage({ sessionToken: supToken, incidenteId: db.incidents[1].id, decision: 'mal-uso', nota: 'Cliente avisado por teléfono' });
  assert.strictEqual(decided.ok, true);
  assert.strictEqual(db.incidents[1].fields.EstadoCobro, 'Por revisar');
  assert.strictEqual(db.incidents[1].fields.ConfirmadoPor, 'SUP-001 · Sofía Rojas');
  assert.strictEqual((await handlers.decideDamage({ sessionToken: supToken, incidenteId: db.incidents[1].id, decision: 'desgaste' })).ok, false, 'ya resuelto');

  // --- Insumos
  const sup1 = await handlers.requestSupplies({ sessionToken: camToken, casaId: 11, piezaId: 502, submissionId: 's-1', items: [{ articulo: 'Papel higiénico', cantidad: 6 }], nota: 'Se acabó' });
  assert.strictEqual(sup1.ok, true);
  assert.strictEqual(db.supplies[0].fields.SolicitadoPor, 'CAM-001 · Ana Pérez', 'queda quién lo pidió');
  assert.strictEqual(db.supplies[0].fields.EstablecimientoId, 11, 'queda para qué casa');
  assert.strictEqual(db.supplies[0].fields.PiezaNumero, '2');
  assert.ok(db.supplies[0].fields.Detalle.includes('Papel higiénico × 6'));
  await handlers.requestSupplies({ sessionToken: camToken, casaId: 11, submissionId: 's-1', items: [{ articulo: 'Papel higiénico', cantidad: 6 }] });
  assert.strictEqual(db.supplies.length, 1, 'doble toque no duplica');
  await handlers.requestSupplies({ sessionToken: camToken, casaId: 11, submissionId: 's-2', items: [{ articulo: 'Cloro', cantidad: 2 }] });
  assert.strictEqual(db.supplies[1].fields.PiezaId, undefined, 'la pieza es opcional: el pedido es por casa');
  assert.strictEqual((await handlers.requestSupplies({ sessionToken: camToken, casaId: 11, submissionId: 's-3', items: [{ articulo: 'Toallas', cantidad: 2 }] })).ok, false);
  assert.strictEqual((await handlers.house({ sessionToken: camToken, casaId: 11 })).pedidos.length, 2);

  // --- Desactivar a la persona o cambiar su PIN mata la sesión al instante
  db.staff[0].fields.PinSalt = 'ffffffffffffffffffffffffffffffff';
  assert.strictEqual((await handlers.houses({ sessionToken: camToken })).sessionExpired, true, 'PIN nuevo invalida sesiones anteriores');
  db.staff[1].fields.Activo = false;
  assert.strictEqual((await handlers.houses({ sessionToken: supToken })).sessionExpired, true, 'persona desactivada no entra');

  console.log('Todas las pruebas de hk pasaron.');
})().catch((error) => { console.error(error); process.exit(1); });
