const assert = require('assert');
process.env.PORTAL_SESSION_SECRET = 'clave-de-prueba-no-real';
const { hashPin } = require('../api/shared/hash');
const { createHandlers } = require('../api/shared/hkHandlers');
const core = require('../api/shared/hkCore');

const SALT_CAM = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
const SALT_SUP = 'f1e2d3c4b5a6f1e2d3c4b5a6f1e2d3c4';
const SALT_COC = '0a1b2c3d4e5f0a1b2c3d4e5f0a1b2c3d';
let nextId = 100;
const duplicate = () => Object.assign(new Error('dup'), { detail: 'The list item already has the value' });
const db = {
  staff: [
    { id: '1', fields: { Title: 'Ana Pérez', Codigo: 'CAM-001', Rol: 'Camarera', Activo: true, PinSalt: SALT_CAM, PinHash: hashPin('482913', SALT_CAM), PinIntentosFallidos: 0 } },
    { id: '3', fields: { Title: 'Luis Mamani', Codigo: 'COC-001', Rol: 'Cocina', Activo: true, PinSalt: SALT_COC, PinHash: hashPin('264817', SALT_COC), PinIntentosFallidos: 0 } },
    { id: '2', fields: { Title: 'Sofía Rojas', Codigo: 'SUP-001', Rol: 'Supervisora', Activo: true, PinSalt: SALT_SUP, PinHash: hashPin('715384', SALT_SUP), PinIntentosFallidos: 0 } }
  ],
  formats: [
    { id: '1', fields: { Title: 'Control de temperatura de equipos', Codigo: 'RG-07-03-07', Area: 'Cocina', Frecuencia: 'Dos veces al día', TomasPorDia: 2, Tipo: 'Temperatura', Activo: true, Orden: 1,
      Puntos: JSON.stringify([{ nombre: 'Refrigeración', min: 0, max: 5 }, { nombre: 'Congelación', min: -22, max: -18 }]) } },
    { id: '2', fields: { Title: 'Salida de comida caliente', Codigo: 'RG-07-03-05', Area: 'Cocina', Tipo: 'Temperatura', Activo: true, Orden: 2, TomasPorDia: 1, Puntos: JSON.stringify([{ nombre: 'Salida caliente', min: 70 }]) } },
    { id: '3', fields: { Title: 'Higiene del personal', Codigo: 'RG-07-01', Area: 'Cocina', Tipo: 'Cumple', Activo: true, Orden: 3, TomasPorDia: 1, Puntos: '' } },
    { id: '5', fields: { Title: 'Limpieza y desinfección de equipos', Codigo: 'ICH-FOR-01-F28', Area: 'Cocina', Tipo: 'Cumple', Activo: true, Orden: 9, TomasPorDia: 0, Puntos: '' } },
    { id: '6', fields: { Title: 'Traslado de alimentos a faena', Codigo: 'ICH-FOR-01-F01', Area: 'Traslado', Tipo: 'Temperatura', Activo: true, Orden: 10, TomasPorDia: 0, Puntos: JSON.stringify([{ nombre: 'Frío en el traslado', max: 5 }, { nombre: 'Caliente en el traslado', min: 65 }]) } },
    { id: '7', fields: { Title: 'Check list de camioneta de reparto', Codigo: 'ICH-FOR-01-F15', Area: 'Traslado', Tipo: 'Cumple', Activo: true, Orden: 11, TomasPorDia: 0, Puntos: '' } },
    { id: '4', fields: { Title: 'Desactivado', Codigo: 'RG-99', Tipo: 'Cumple', Activo: false, Orden: 4, Puntos: '' } }
  ],
  assets: [
    { id: '10', fields: { EstablecimientoId: 7, Title: 'Cámara de frío 1', Codigo: 'FRIO-01', Categoria: 'Frío', Estado: 'Operativo', PuntoTemperatura: 'Refrigeración', FormatoTemperatura: 'RG-07-03-07' } },
    { id: '11', fields: { EstablecimientoId: 7, Title: 'Cambro 3', Codigo: 'CMB-03', Categoria: 'Cambro', Estado: 'Operativo' } },
    { id: '13', fields: { EstablecimientoId: 7, Title: 'Camioneta 1', Codigo: 'VEH-001', Categoria: 'Vehículo', Estado: 'Operativo' } },
    { id: '14', fields: { EstablecimientoId: 7, Title: 'CAMBRO 001', Codigo: 'CMB-001', Categoria: 'Cambro', Estado: 'Operativo' } },
    { id: '15', fields: { EstablecimientoId: 7, Title: 'CAMBRO 002', Codigo: 'CMB-002', Categoria: 'Cambro', Estado: 'Operativo' } },
    { id: '12', fields: { Title: 'Horno viejo', Codigo: 'HOR-09', Categoria: 'Cocina', Estado: 'De baja' } }
  ],
  plans: [
    { id: '1', fields: { ActivoId: 10, Activo: true, Descripcion: 'Revisar compresor', ProximaFecha: '2026-12-15T00:00:00Z' } },
    { id: '2', fields: { ActivoId: 10, Activo: true, Descripcion: 'Limpiar condensador', ProximaFecha: '2026-11-01T00:00:00Z' } },
    { id: '3', fields: { ActivoId: 10, Activo: false, Descripcion: 'Plan apagado', ProximaFecha: '2026-10-01T00:00:00Z' } }
  ],
  incidents: [],
  records: [], uploads: []
};
const repo = {
  findStaffByCode: async (code) => db.staff.find((p) => p.fields.Codigo === code),
  getStaffById: async (id) => db.staff.find((p) => p.id === String(id)),
  updateStaff: async (id, fields) => { Object.assign(db.staff.find((p) => p.id === String(id)).fields, fields); },
  listBpmFormats: async () => db.formats,
  listCambros: async () => db.assets.filter((a) => a.fields.Categoria === 'Cambro'),
  getAssetByCode: async (code) => db.assets.find((a) => a.fields.Codigo === code),
  listMaintenancePlansOfAsset: async (id) => db.plans.filter((p) => String(p.fields.ActivoId) === String(id)),
  createEquipmentIncident: async (fields) => {
    if (db.incidents.some((i) => i.SubmissionId === fields.SubmissionId)) throw duplicate();
    db.incidents.push({ ...fields });
  },
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
  assert.strictEqual(core.canBpm('Cocina'), true);
  assert.strictEqual(core.canBpm('Camarera'), false);
  const coc = await handlers.login({ codigo: 'COC-001', pin: '264817' });
  assert.strictEqual(coc.persona.soloBpm, true, 'cocina entra solo a BPM');
  assert.strictEqual(coc.persona.bpm, true);
  assert.strictEqual(cam.persona.bpm, false);
  const cocList = await handlers.bpmList({ sessionToken: coc.sessionToken });
  assert.strictEqual(cocList.ok, true, 'cocina ve las hojas BPM');
  const cocSent = await handlers.bpmRecord({ sessionToken: coc.sessionToken, codigo: 'RG-07-01', cumple: true, fotoBase64: PHOTO, submissionId: 'coc-1' });
  assert.strictEqual(cocSent.ok, true, 'cocina sube su hoja');
  assert.strictEqual(db.records.pop().fields.RegistradoPorCodigo, 'COC-001');
  const cocHouses = await handlers.houses({ sessionToken: coc.sessionToken });
  assert.strictEqual(cocHouses.ok, false, 'cocina no entra a casas ni piezas');
  assert.ok(/solo para subir/.test(cocHouses.message));

  // --- Lista del día
  const list = await handlers.bpmList({ sessionToken: sup.sessionToken });
  assert.strictEqual(list.ok, true);
  assert.deepStrictEqual(list.formatos.map((f) => f.codigo), ['RG-07-03-07', 'RG-07-03-05', 'RG-07-01', 'ICH-FOR-01-F28', 'ICH-FOR-01-F01', 'ICH-FOR-01-F15'], 'solo activos y en orden');
  assert.strictEqual(list.hoy, '2026-11-07');
  assert.strictEqual(list.formatos[0].hechos.length, 0);

  // --- Registrar
  const send = (extra) => handlers.bpmRecord({ sessionToken: sup.sessionToken, codigo: 'RG-07-03-07', punto: 'Refrigeración', minimo: 1, maximo: 4, turno: 'Mañana', lugar: 'Cámara 1', fotoBase64: PHOTO, submissionId: 'b-1', ...extra });
  // Hoja diaria normal: la foto es opcional (se anota en línea, sin foto).
  const sinFoto = await send({ fotoBase64: undefined, submissionId: 'b-0' });
  assert.strictEqual(sinFoto.ok, true, 'hoja diaria conforme se guarda sin foto');
  assert.strictEqual(db.records.pop().fields.FotoUrl, '', 'sin foto queda vacío');
  // Fuera de límite: la foto sí es obligatoria.
  const fueraSinFoto = await send({ fotoBase64: undefined, submissionId: 'b-0b', maximo: 9, observacion: 'Se pasó a otra cámara' });
  assert.strictEqual(fueraSinFoto.ok, false);
  assert.ok(/foto/.test(fueraSinFoto.message));
  // Hoja periódica (plagas, mensual…): la foto es obligatoria aunque esté conforme.
  db.formats[0].fields.PeriodoDias = 30;
  const periodicaSinFoto = await send({ fotoBase64: undefined, submissionId: 'b-0c' });
  assert.strictEqual(periodicaSinFoto.ok, false);
  assert.ok(/periódica/.test(periodicaSinFoto.message));
  assert.strictEqual((await handlers.bpmList({ sessionToken: sup.sessionToken })).formatos[0].periodica, true);
  delete db.formats[0].fields.PeriodoDias;
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

  // --- QR de equipo
  db.records.length = 0;
  const scan = await handlers.equipoScan({ sessionToken: sup.sessionToken, codigo: 'FRIO-01' });
  assert.strictEqual(scan.ok, true);
  assert.strictEqual(scan.equipo.nombre, 'Cámara de frío 1');
  assert.strictEqual(scan.temperatura.codigo, 'RG-07-03-07');
  assert.deepStrictEqual(scan.temperatura.puntos.map((p) => p.nombre), ['Refrigeración'], 'solo el punto de ese equipo');
  assert.strictEqual(scan.limpieza.codigo, 'ICH-FOR-01-F28');
  const cambro = await handlers.equipoScan({ sessionToken: sup.sessionToken, codigo: 'CMB-03' });
  assert.strictEqual(cambro.temperatura, null, 'un equipo sin punto de control no pide temperatura');
  assert.strictEqual((await handlers.equipoScan({ sessionToken: sup.sessionToken, codigo: 'HOR-09' })).ok, false, 'de baja no se escanea');
  assert.strictEqual((await handlers.equipoScan({ sessionToken: sup.sessionToken, codigo: "x'; drop" })).ok, false, 'código raro');
  assert.strictEqual((await handlers.equipoScan({ sessionToken: cam.sessionToken, codigo: 'FRIO-01' })).ok, false, 'la camarera no');
  const t = await handlers.bpmRecord({ sessionToken: sup.sessionToken, codigo: 'RG-07-03-07', activoCodigo: 'FRIO-01', minimo: 3, maximo: 3, lugar: 'otro', punto: 'Congelación', submissionId: 'eq-1' });
  assert.strictEqual(t.ok, true);
  assert.strictEqual(db.records[0].fields.ActivoCodigo, 'FRIO-01');
  assert.strictEqual(db.records[0].fields.Lugar, 'Cámara de frío 1', 'manda el equipo, no lo que escribió el celular');
  assert.strictEqual(db.records[0].fields.Punto, 'Refrigeración');
  const l = await handlers.bpmRecord({ sessionToken: sup.sessionToken, codigo: 'ICH-FOR-01-F28', activoCodigo: 'CMB-03', cumple: true, submissionId: 'eq-2' });
  assert.strictEqual(l.ok, true, 'limpieza de un cambro sin foto');
  assert.strictEqual(db.records[1].fields.Lugar, 'Cambro 3');
  const again = await handlers.equipoScan({ sessionToken: sup.sessionToken, codigo: 'FRIO-01' });
  assert.strictEqual(again.temperatura.hechos.length, 1, 'lo anotado hoy en ese equipo aparece');
  assert.strictEqual(again.limpieza.hechos.length, 0, 'lo de otro equipo no');
  assert.strictEqual((await handlers.bpmRecord({ sessionToken: sup.sessionToken, codigo: 'ICH-FOR-01-F28', activoCodigo: 'NADA-1', cumple: true, submissionId: 'eq-3' })).ok, false, 'equipo inexistente');

  // --- Mantención y falla desde el QR
  assert.strictEqual(scan.mantencion.fecha, '2026-11-01', 'la más cercana de los planes activos');
  assert.strictEqual(scan.mantencion.vencida, true, 'ya pasó: vencida');
  assert.strictEqual(scan.mantencion.descripcion, 'Limpiar condensador');
  assert.strictEqual(cambro.mantencion, null, 'sin plan, sin mantención');
  const falla = (extra) => handlers.equipoFalla({ sessionToken: sup.sessionToken, codigo: 'FRIO-01', descripcion: 'No enfría, hace ruido', submissionId: 'f-1', ...extra });
  assert.strictEqual((await falla({ descripcion: 'x' })).ok, false, 'hay que contar qué pasa');
  assert.strictEqual((await falla({ codigo: 'NADA-1' })).ok, false);
  assert.strictEqual((await handlers.equipoFalla({ sessionToken: cam.sessionToken, codigo: 'FRIO-01', descripcion: 'No enfría', submissionId: 'f-0' })).ok, false, 'la camarera no');
  const okFalla = await falla({ afectaContinuidad: true, fotoBase64: PHOTO });
  assert.strictEqual(okFalla.ok, true);
  assert.strictEqual(db.incidents.length, 1);
  assert.strictEqual(db.incidents[0].Tipo, 'Equipamiento');
  assert.strictEqual(db.incidents[0].Prioridad, 'Alta', 'sin el equipo no se trabaja: alta');
  assert.strictEqual(db.incidents[0].EstablecimientoId, 7);
  assert.strictEqual(db.incidents[0].ActivoCodigo, 'FRIO-01');
  assert.ok(db.incidents[0].Descripcion.startsWith('[FRIO-01 · Cámara de frío 1]'));
  assert.ok(db.incidents[0].FotoUrl.includes('EquipoFotos/2026-11/FRIO-01-'));
  await falla({});
  assert.strictEqual(db.incidents.length, 1, 'doble toque no duplica');
  await falla({ submissionId: 'f-2', afectaContinuidad: false });
  assert.strictEqual(db.incidents[1].Prioridad, 'Media');
  assert.strictEqual(db.incidents[1].FotoUrl, '', 'la foto de una falla es opcional');

  // --- Vehículo: controles y traslado de los cambros a la faena
  const veh = await handlers.equipoScan({ sessionToken: sup.sessionToken, codigo: 'VEH-001' });
  assert.strictEqual(veh.ok, true);
  assert.deepStrictEqual(veh.otros.map((o) => o.codigo), ['ICH-FOR-01-F15'], 'check list del vehículo (la sanitización aún no está en el catálogo de la prueba)');
  assert.deepStrictEqual(veh.traslado.cambros.map((x) => x.codigo), ['CMB-001', 'CMB-002', 'CMB-03']);
  assert.strictEqual(veh.traslado.formato.puntos.length, 2);
  assert.strictEqual(scan.traslado, null, 'un equipo común no tiene traslado');
  db.records.length = 0;
  const tr = (extra) => handlers.trasladoRecord({ sessionToken: sup.sessionToken, codigo: 'VEH-001', momento: 'Salida', destino: 'Faena Norte', submissionId: 'tr-1',
    lecturas: [{ codigo: 'CMB-001', punto: 'Caliente en el traslado', temperatura: 72 }, { codigo: 'CMB-002', punto: 'Frío en el traslado', temperatura: '3,5' }], ...extra });
  assert.strictEqual((await tr({ momento: 'Mañana' })).ok, false, 'salida o llegada');
  assert.strictEqual((await tr({ destino: '' })).ok, false, 'falta la faena');
  assert.strictEqual((await tr({ lecturas: [] })).ok, false);
  assert.strictEqual((await tr({ codigo: 'FRIO-01' })).ok, false, 'solo desde el QR de un vehículo');
  assert.strictEqual((await tr({ lecturas: [{ codigo: 'FRIO-01', punto: 'Frío en el traslado', temperatura: 3 }] })).ok, false, 'solo cambros');
  assert.strictEqual((await tr({ lecturas: [{ codigo: 'CMB-001', punto: 'Caliente en el traslado', temperatura: 60 }, { codigo: 'CMB-002', punto: 'Frío en el traslado', temperatura: 3 }] })).ok, false, 'fuera de límite sin decir qué se hizo');
  assert.strictEqual(db.records.length, 0, 'si uno falla no se guarda ninguno');
  const trOk = await tr({});
  assert.strictEqual(trOk.ok, true);
  assert.strictEqual(trOk.fuera, 0);
  assert.strictEqual(db.records.length, 2);
  assert.strictEqual(db.records[0].fields.ActivoCodigo, 'CMB-001');
  assert.strictEqual(db.records[0].fields.Lugar, 'CAMBRO 001 · Salida · Faena Norte');
  assert.strictEqual(db.records[1].fields.Minimo, 3.5);
  await tr({});
  assert.strictEqual(db.records.length, 2, 'doble toque no duplica');
  const trFuera = { lecturas: [{ codigo: 'CMB-001', punto: 'Caliente en el traslado', temperatura: 60, observacion: 'Se recalentó' }, { codigo: 'CMB-002', punto: 'Frío en el traslado', temperatura: 3 }] };
  assert.strictEqual((await tr({ ...trFuera, submissionId: 'tr-2' })).ok, false, 'fuera de límite pide foto');
  const trF = await tr({ ...trFuera, submissionId: 'tr-3', fotoBase64: PHOTO });
  assert.strictEqual(trF.ok, true);
  assert.strictEqual(trF.fuera, 1);
  const fueraRecs = db.records.filter((r) => r.fields.SubmissionId.startsWith('tr-3'));
  assert.strictEqual(fueraRecs[0].fields.Resultado, 'Fuera de límite');
  assert.ok(fueraRecs[0].fields.FotoUrl.includes('ICH-FOR-01-F01'));
  assert.strictEqual(fueraRecs[1].fields.FotoUrl, '', 'solo el cambro fuera de límite lleva la foto');
  assert.strictEqual((await handlers.trasladoRecord({ sessionToken: cam.sessionToken, codigo: 'VEH-001', momento: 'Salida', destino: 'X', submissionId: 'z', lecturas: [{ codigo: 'CMB-001', punto: 'Frío en el traslado', temperatura: 3 }] })).ok, false, 'la camarera no');

  console.log('Todas las pruebas de BPM pasaron.');
})().catch((error) => { console.error(error); process.exit(1); });
