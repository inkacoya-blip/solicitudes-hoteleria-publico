const assert = require('assert');
const core = require('../api/shared/hkCore');

// Fechas y permisos de edición
const today = '2026-11-05';
assert.strictEqual(core.addDays('2026-11-01', -1), '2026-10-31');
assert.strictEqual(core.addDays('2026-12-31', 1), '2027-01-01');
assert.strictEqual(core.dayNumber('2026-11-05'), 20261105);
assert.strictEqual(core.isIsoDate('2026-02-30'), false, 'fecha imposible');
assert.strictEqual(core.isIsoDate('hoy'), false);
assert.strictEqual(core.checkWorkDate('Camarera', '2026-11-05', today).ok, true);
assert.strictEqual(core.checkWorkDate('Camarera', '2026-11-04', today).ok, true, 'ayer sí');
assert.strictEqual(core.checkWorkDate('Camarera', '2026-11-03', today).ok, false, 'antes de ayer no');
assert.strictEqual(core.checkWorkDate('Camarera', '2026-11-06', today).ok, false, 'el futuro nunca');
assert.strictEqual(core.checkWorkDate('Supervisora', '2026-10-25', today).ok, true, 'supervisora corrige hasta 14 días');
assert.strictEqual(core.checkWorkDate('Supervisora', '2026-10-20', today).ok, false);

// Hora de Chile: a las 22:30 del 5-nov (UTC-3) ya son las 01:30 UTC del 6-nov y el día sigue siendo el 5
assert.strictEqual(core.chileToday(new Date('2026-11-06T01:30:00Z')), '2026-11-05');

// Orden natural de piezas
assert.deepStrictEqual(['10', '2', '3A', '3', '1'].sort(core.compareRoomNumbers), ['1', '2', '3', '3A', '10']);

// Validación de una pieza
const room = { Camas: 2 };
const allowed = [2, 10];
assert.strictEqual(core.normalizeRoomInput({ ocupacion: 'Ocupada', contratoId: 2, personas: 2, camas: 2, limpiezaDiaria: true }, room, allowed).ok, true);
assert.strictEqual(core.normalizeRoomInput({ ocupacion: 'Ocupada', contratoId: 99, personas: 2, camas: 2 }, room, allowed).ok, false, 'contrato que la casa no tiene');
assert.strictEqual(core.normalizeRoomInput({ ocupacion: 'Ocupada', contratoId: 2, personas: 0, camas: 1 }, room, allowed).ok, false, 'ocupada sin personas');
assert.strictEqual(core.normalizeRoomInput({ ocupacion: 'Ocupada', contratoId: 2, personas: 2, camas: 3 }, room, allowed).ok, false, 'más camas que la pieza');
assert.strictEqual(core.normalizeRoomInput({ ocupacion: 'Ocupada', personas: 2, camas: 1 }, room, allowed).ok, false, 'sin contrato');
assert.strictEqual(core.normalizeRoomInput({ ocupacion: 'Rara' }, room, allowed).ok, false);
const vacia = core.normalizeRoomInput({ ocupacion: 'Vacía', contratoId: 2, personas: 4, camas: 1, limpiezaDiaria: true }, room, allowed);
assert.strictEqual(vacia.ok, true);
assert.strictEqual(vacia.value.ContratoId, null, 'vacía no arrastra contrato');
assert.strictEqual(vacia.value.Personas, 0);
assert.strictEqual(core.normalizeRoomInput({ ocupacion: 'Ocupada', contratoId: 2, personas: '2', camas: '1' }, { Camas: 0 }, allowed).ok, true, 'pieza sin camas cargadas acepta hasta 20');

// Cambios para la bitácora
const before = { Ocupacion: 'Ocupada', ContratoId: 2, Personas: 2, Camas: 2, LimpiezaDiaria: false, CambioSabanas: false, AseoFondo: false, SinDanos: false, Observacion: '' };
const same = core.normalizeRoomInput({ ocupacion: 'Ocupada', contratoId: 2, personas: 2, camas: 2 }, room, allowed).value;
assert.deepStrictEqual(core.diffRoomLog(before, same), [], 'sin cambios no se anota nada');
const next = core.normalizeRoomInput({ ocupacion: 'Ocupada', contratoId: 10, personas: 1, camas: 1, limpiezaDiaria: true }, room, allowed).value;
const changes = core.diffRoomLog(before, next);
assert.deepStrictEqual(changes.map((item) => item.campo).sort(), ['Camas usadas', 'Contrato', 'Limpieza diaria', 'Personas'].sort());
assert.strictEqual(changes.find((item) => item.campo === 'Limpieza diaria').nuevo, 'Sí');

// Sugerencia desde el parte anterior
assert.deepStrictEqual(core.suggestFromPrevious({ Ocupacion: 'Ocupada', ContratoId: 2, Personas: 2, Camas: 2 }), { ocupacion: 'Ocupada', contratoId: 2, personas: 2, camas: 2 });
assert.strictEqual(core.suggestFromPrevious({ Ocupacion: 'Sale hoy', ContratoId: 2 }).ocupacion, 'Vacía', 'si salió, hoy parte vacía');
assert.strictEqual(core.suggestFromPrevious(undefined), null);
const latest = core.latestLogPerRoom([
  { id: '1', fields: { PiezaId: 5, Dia: 20261101, Ocupacion: 'Ocupada' } },
  { id: '2', fields: { PiezaId: 5, Dia: 20261103, Ocupacion: 'Vacía' } },
  { id: '3', fields: { PiezaId: 6, Dia: 20261102, Ocupacion: 'Ocupada' } }
]);
assert.strictEqual(latest.get(5).id, '2');
assert.strictEqual(latest.get(6).id, '3');

// Muestra al azar por camarera: fija para la misma fecha, máximo 3 por persona
const logs = [];
for (let i = 1; i <= 10; i += 1) logs.push({ fields: { PiezaId: i, RegistradoPor: 'CAM-001 · Ana' } });
for (let i = 11; i <= 12; i += 1) logs.push({ fields: { PiezaId: i, RegistradoPor: 'CAM-002 · Luz' } });
const sample = core.pickReviewSample(logs, '2026-11-05', 3);
assert.strictEqual(sample.size, 5, '3 de Ana + las 2 de Luz');
assert.deepStrictEqual([...core.pickReviewSample(logs, '2026-11-05', 3)].sort(), [...sample].sort(), 'misma fecha, misma muestra');
assert.notDeepStrictEqual([...core.pickReviewSample(logs, '2026-11-06', 3)].sort(), [...sample].sort(), 'otro día, otra muestra');

// Pedido de insumos
assert.strictEqual(core.formatSupplyRequest([{ articulo: 'Papel higiénico', cantidad: 4 }, { articulo: 'Jabón de manos', cantidad: '2' }]).detail, 'Papel higiénico × 4\nJabón de manos × 2');
assert.strictEqual(core.formatSupplyRequest([]).ok, false);
assert.strictEqual(core.formatSupplyRequest([{ articulo: 'Toallas', cantidad: 1 }]).ok, false, 'no hay toallas en el catálogo');
assert.strictEqual(core.formatSupplyRequest([{ articulo: 'Cloro', cantidad: 0 }]).ok, false);
assert.strictEqual(core.formatSupplyRequest([{ articulo: 'Otro', cantidad: 1 }]).ok, false, 'otro necesita detalle');
assert.strictEqual(core.formatSupplyRequest([{ articulo: 'Otro', cantidad: 1, detalle: 'Ampolleta' }]).detail, 'Ampolleta × 1');

// Contratos vigentes en la fecha
const links = [
  { fields: { ContratoId: 1, FechaDesde: '2026-01-01T00:00:00Z', FechaHasta: '2026-12-31T00:00:00Z' } },
  { fields: { ContratoId: 2, FechaDesde: '2026-12-01T00:00:00Z' } },
  { fields: { ContratoId: 3, FechaDesde: '2026-01-01T00:00:00Z', FechaHasta: '2026-10-31T00:00:00Z' } }
];
assert.deepStrictEqual(core.activeContractLinks(links, '2026-11-05').map((link) => link.fields.ContratoId), [1]);

console.log('Todas las pruebas de hkCore pasaron.');
