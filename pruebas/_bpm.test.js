const assert = require('assert');
process.env.PORTAL_SESSION_SECRET = 'clave-de-prueba-no-real';
const { hashPin } = require('../api/shared/hash');
const { createHandlers } = require('../api/shared/hkHandlers');
const core = require('../api/shared/hkCore');

const SALT_CAM = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
const SALT_SUP = 'f1e2d3c4b5a6f1e2d3c4b5a6f1e2d3c4';
let nextId = 100;
const duplicate = () => Object.assign(new Error('dup'), { detail: 'The list item already has the value' });
const db = {
  staff: [
    { id: '1', fields: { Title: 'Ana Pérez', Codigo: 'CAM-001', Rol: 'Camarera', Activo: true, PinSalt: SALT_CAM, PinHash: hashPin('482913', SALT_CAM), PinIntentosFallidos: 0 } },
    { id: '2', fields: { Title: 'Sofía Rojas', Codigo: 'SUP-001', Rol: 'Supervisora', Activo: true, PinSalt: SALT_SUP, PinHash: hashPin('715384', SALT_SUP), PinIntentosFallidos: 0 } }
  ],
  formats: [
    { id: '1', fields: { Title: 'Control de temperatura de equipos', Codigo: 'RG-07-03-07', Area: 'Cocina', Frecuencia: 'Dos veces al día', TomasPorDia: 2, Tipo: 'Temperatura', Activo: true, Orden: 1,
      Puntos: JSON.stringify([{ nombre: 'Refrigeración', min: 0, max: 5 }, { nombre: 'Congelación', min: -22, max: -18 }]) } },
    { id: '2', fields: { Title: 'Salida de comida caliente', Codigo: 'RG-07-03-05', Area: 'Cocina', Tipo: 'Temperatura', Activo: true, Orden: 2, TomasPorDia: 1, Puntos: JSON.stringify([{ nombre: 'Salida caliente', min: 70 }]) } },
    { id: '3', fields: { Title: 'Higiene del personal', Codigo: 'RG-07-01', Area: 'Cocina', Tipo: 'Cumple', Activo: true, Orden: 3, TomasPorDia: 1, Puntos: '' } },
    { id: '4', fields: { Title: 'Desactivado', Codigo: 'RG-99', Tipo: 'Cumple', Activo: false, Orden: 4, Puntos: '' } }
  ],
  records: [], uploads: []
};
const repo = {
  findStaffByCode: async (code) => db.staff.find((p) => p.fields.Codigo === code),
  getStaffById: async (id) => db.staff.find((p) => p.id === String(id)),
  updateStaff: async (id, fields) => { Object.assign(db.staff.find((p) => p.id === String(id)).fields, fields); },
  listBpmFormats: async () => db.formats,
  listBpmRecordsByDay: async (dia) => db.records.filter((r) => r.fields.Dia === dia),
  createBpmRecord: async (fields) => {
    if (db.records.some((r) => r.fields.SubmissionId === fields.SubmissionId)) throw duplicate();
    const item = { id: String(++nextId), fields: { ...fields } };
    db.records.push(item);
    return item;
  }
};
const handlers = createHandlers({ repo, uploadFile: async (path) => { db.uploads.push(path); return `https://sp/${path}`; }, now: () => new Date('2026-11-07T15:00:00Z') });
const PHOTO = Buffer.from('foto').toString('base64');

(async () => {
  // --- Reglas puras
  const fmt = core.parseBpmFormat(db.formats[0]);
  assert.strictEqual(fmt.puntos.length, 2);
  assert.strictEqual(core.evaluateBpm(fmt, { punto: 'Refrigeración', minimo: 1, maximo: 4 }).value.Resultado, 'Conforme');
  assert.strictEqual(core.evaluateBpm(fmt, { punto: 'Refrigeración', minimo: '2,5', maximo: '4,5' }).ok, true, 'acepta coma decimal');
  const hot = core.evaluateBpm(fmt, { punto: 'Refrigeración', minimo: 2, maximo: 7, observacion: 'Se movió el producto' });
  assert.strictEqual(hot.value.Resultado, 'Fuera de límite');
  assert.strictEqual(hot.value.AccionEstado, 'Pendiente');
  assert.ok(/qué se hizo/.test(core.evaluateBpm(fmt, { punto: 'Refrigeración', minimo: 2, maximo: 7 }).message), 'fuera de límite exige decir qué se hizo');
  assert.strictEqual(core.evaluateBpm(fmt, { punto: 'Congelación', minimo: -21, maximo: -19 }).value.Resultado, 'Conforme');
  assert.strictEqual(core.evaluateBpm(fmt, { punto: 'Congelación', minimo: -17, maximo: -15, observacion: 'Se llamó a mantención' }).value.Resultado, 'Fuera de límite');
  assert.strictEqual(core.evaluateBpm(fmt, { punto: 'Refrigeración', minimo: 4, maximo: 2 }).ok, false, 'mínima mayor que máxima');
  assert.strictEqual(core.evaluateBpm(fmt, { punto: 'Refrigeración', minimo: 999, maximo: 1000 }).ok, false, 'temperatura imposible');
  assert.strictEqual(core.evaluateBpm(fmt, { punto: 'Otro', minimo: 1, maximo: 2 }).ok, false, 'punto que no existe');
  assert.strictEqual(core.evaluateBpm(fmt, { punto: 'Refrigeración' }).ok, false, 'sin números ni «fuera de límite»');
  const manual = core.evaluateBpm(fmt, { punto: 'Refrigeración', fuera: true, observacion: 'Termómetro roto, se midió otro' });
  assert.strictEqual(manual.value.Resultado, 'Fuera de límite', '«Fuera de límite» sin números');
  const hotFmt = core.parseBpmFormat(db.formats[1]);
  assert.strictEqual(core.evaluateBpm(hotFmt, { punto: 'Salida caliente', minimo: 72, maximo: 80 }).value.Resultado, 'Conforme');
  assert.strictEqual(core.evaluateBpm(hotFmt, { punto: 'Salida caliente', minimo: 68, maximo: 80, observacion: 'Se recalentó' }).value.Resultado, 'Fuera de límite', 'caliente bajo 70 °C');
  const yes = core.parseBpmFormat(db.formats[2]);
  assert.strictEqual(core.evaluateBpm(yes, { cumple: true }).value.Resultado, 'Conforme');
  assert.strictEqual(core.evaluateBpm(yes, { cumple: false, observacion: 'Faltó guantes' }).value.AccionEstado, 'Pendiente');
  assert.strictEqual(core.evaluateBpm(yes, {}).ok, false);

  // --- Entrada y permisos
  const cam = await handlers.login({ codigo: 'CAM-001', pin: '482913' });
  const sup = await handlers.login({ codigo: 'SUP-001', pin: '715384' });
  assert.strictEqual((await handlers.bpmList({ sessionToken: cam.sessionToken })).ok, false, 'la camarera no ve los registros BPM');
  assert.strictEqual((await handlers.bpmRecord({ sessionToken: cam.sessionToken, codigo: 'RG-07-01', cumple: true, fotoBase64: PHOTO, submissionId: 'x' })).ok, false);
  assert.strictEqual((await handlers.bpmList({ sessionToken: 'basura' })).sessionExpired, true);

  // --- Lista del día
  const list = await handlers.bpmList({ sessionToken: sup.sessionToken });
  assert.strictEqual(list.ok, true);
  assert.deepStrictEqual(list.formatos.map((f) => f.codigo), ['RG-07-03-07', 'RG-07-03-05', 'RG-07-01'], 'solo activos y en orden');
  assert.strictEqual(list.hoy, '2026-11-07');
  assert.strictEqual(list.formatos[0].hechos.length, 0);

  // --- Registrar
  const send = (extra) => handlers.bpmRecord({ sessionToken: sup.sessionToken, codigo: 'RG-07-03-07', punto: 'Refrigeración', minimo: 1, maximo: 4, turno: 'Mañana', lugar: 'Cámara 1', fotoBase64: PHOTO, submissionId: 'b-1', ...extra });
  const sinFoto = await send({ fotoBase64: undefined, submissionId: 'b-0' });
  assert.strictEqual(sinFoto.ok, false);
  assert.ok(/foto/.test(sinFoto.message));
  const ok = await send({});
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.fuera, false);
  assert.strictEqual(db.records.length, 1);
  assert.strictEqual(db.records[0].fields.Resultado, 'Conforme');
  assert.strictEqual(db.records[0].fields.Dia, 20261107);
  assert.strictEqual(db.records[0].fields.RegistradoPor.includes('Sofía'), true);
  assert.ok(db.records[0].fields.FotoUrl.startsWith('https://sp/BpmFotos/2026-11/RG-07-03-07-2026-11-07-'));
  await send({});
  assert.strictEqual(db.records.length, 1, 'doble toque no duplica');
  const bad = await send({ submissionId: 'b-2', maximo: 9 });
  assert.strictEqual(bad.ok, false, 'fuera de límite sin decir qué se hizo no se guarda');
  const out = await send({ submissionId: 'b-3', maximo: 9, observacion: 'Se pasó el producto a otra cámara' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.fuera, true);
  assert.strictEqual(db.records[1].fields.AccionEstado, 'Pendiente');
  assert.strictEqual((await send({ codigo: 'RG-99', submissionId: 'b-4' })).ok, false, 'formato desactivado');
  assert.strictEqual((await send({ codigo: 'NADA', submissionId: 'b-5' })).ok, false);
  assert.strictEqual((await send({ fecha: '2026-11-08', submissionId: 'b-6' })).ok, false, 'no se registra el futuro');
  assert.strictEqual((await send({ fecha: '2026-10-01', submissionId: 'b-7' })).ok, false, 'ni más de 14 días atrás');
  const yesterday = await send({ fecha: '2026-11-06', submissionId: 'b-8' });
  assert.strictEqual(yesterday.ok, true, 'puede subir la hoja de ayer');
  const after = await handlers.bpmList({ sessionToken: sup.sessionToken });
  assert.strictEqual(after.formatos[0].hechos.length, 2, 'lo de hoy aparece hecho; lo de ayer no cuenta hoy');
  assert.strictEqual(after.formatos[0].hechos[1].resultado, 'Fuera de límite');

  console.log('Todas las pruebas de BPM pasaron.');
})().catch((error) => { console.error(error); process.exit(1); });
