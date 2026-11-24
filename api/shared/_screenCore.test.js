const assert = require('assert');
const { screenDate, buildScreen } = require('./screenCore');

// Cambio de día a las 20:00 de Chile (noviembre = GMT-3).
assert.strictEqual(screenDate(new Date('2026-11-23T22:59:00Z')), '2026-11-23', '19:59 Chile: todavía hoy');
assert.strictEqual(screenDate(new Date('2026-11-23T23:00:00Z')), '2026-11-24', '20:00 Chile: ya mañana');
assert.strictEqual(screenDate(new Date('2026-11-24T02:30:00Z')), '2026-11-24', '23:30 Chile: mañana');
assert.strictEqual(screenDate(new Date('2026-11-24T03:30:00Z')), '2026-11-24', '00:30 Chile del 24: hoy (24)');

const F = '2026-11-24T03:00:00Z';
let id = 0;
const req = (fields) => ({ id: String(++id), fields: { FechaServicio: F, OrigenSolicitud: 'Cliente', EstadoSolicitud: 'Oficial', ...fields } });
const contracts = [
  { id: '5', fields: { ClienteId: 7, Estado: 'Vigente', FechaInicio: '2026-01-01', ApodoServicio: 'BASE', NumeroContrato: 'ICH-CTR-5', ProyeccionAutomatica: true } },
  { id: '2', fields: { ClienteId: 2, Estado: 'Vigente', FechaInicio: '2026-01-01', NumeroContrato: 'ICH-CTR-2', ProyeccionAutomatica: true } },
  { id: '9', fields: { ClienteId: 9, Estado: 'Vigente', FechaInicio: '2026-01-01', NumeroContrato: 'ICH-CTR-9', ProyeccionAutomatica: true } }
];
const clients = [{ id: '7', fields: { RazonSocial: 'MANTOS' } }, { id: '2', fields: { RazonSocial: 'MECAMIN' } }, { id: '9', fields: { RazonSocial: 'ORBIT' } }];
const old = req({ ClienteId: 9, ContratoId: 9, TipoServicio: 'Cena', CantidadOficial: 50 });
const requests = [
  req({ ClienteId: 7, ContratoId: 5, TipoServicio: 'Cena', CantidadOficial: 3 }),
  req({ ClienteId: 7, ContratoId: 5, TipoServicio: 'Almuerzo', CantidadOficial: 0 }),
  // Mecamin: extraordinaria pendiente + sugerencia que queda en historial.
  req({ ClienteId: 2, ContratoId: 2, TipoServicio: 'Cena', CantidadOficial: 57, EstadoSolicitud: 'Extraordinaria pendiente' }),
  req({ ClienteId: 2, ContratoId: 2, TipoServicio: 'Cena', CantidadOficial: 40, EstadoSolicitud: 'Arrastre automático', OrigenSolicitud: 'Proyección automática' }),
  // Orbit: cena reemplazada (50 → 65) y colaciones en dos horarios.
  old,
  req({ ClienteId: 9, ContratoId: 9, TipoServicio: 'Cena', CantidadOficial: 65, ReemplazaSolicitudId: Number(old.id) }),
  req({ ClienteId: 9, ContratoId: 9, TipoServicio: 'Colación sándwich', CantidadOficial: 10, HoraServicio: '18:30', Observacion: 'Operadores noche' }),
  req({ ClienteId: 9, ContratoId: 9, TipoServicio: 'Colación sándwich', CantidadOficial: 4, HoraServicio: '06:30' }),
  req({ ClienteId: 9, ContratoId: 9, TipoServicio: 'Hospedaje', CantidadOficial: 8 }),
  req({ ClienteId: 9, ContratoId: 9, TipoServicio: 'Cena', CantidadOficial: 99, FechaServicio: '2026-11-25T03:00:00Z' })
];
const rates = [{ id: '1', fields: { ContratoId: 9, TipoServicio: 'Colación sándwich', Descripcion: 'Sándwich pan grande + bebida 600 cc', Activo: true } }];

const screen = buildScreen({ date: '2026-11-24', requests, contracts, clients, rates });
const byName = (rows, name) => rows.find((r) => r.empresa === name);

assert.deepStrictEqual(screen.alimentacion.columnas.slice(0, 6), ['Desayuno', 'Desayuno reforzado', 'Almuerzo', 'Almuerzo hipocalórico', 'Cena', 'Cena hipocalórica']);
assert.deepStrictEqual(byName(screen.alimentacion.filas, 'MANTOS').alimentacion, { Cena: 3 }, 'cero no se muestra');
assert.strictEqual(byName(screen.alimentacion.filas, 'MANTOS').contrato, 'BASE', 'contrato con apodo se muestra');
const mecamin = byName(screen.alimentacion.filas, 'MECAMIN');
assert.strictEqual(mecamin.situacion, 'pendiente');
assert.deepStrictEqual(mecamin.alimentacion, {}, 'lo pendiente no se suma como vigente');
assert.deepStrictEqual(mecamin.alimentacionPorAprobar, { Cena: 57 }, 'muestra lo que está por aprobar');
assert.ok(mecamin.observaciones.includes('Pendiente de decisión'));
assert.ok(!mecamin.observaciones.includes('40'), 'la sugerencia reemplazada no aparece');
assert.deepStrictEqual(byName(screen.alimentacion.filas, 'ORBIT').alimentacion, { Cena: 65 }, 'solo la vigente, sin Hospedaje ni otro día');
assert.strictEqual(screen.alimentacion.totales.Cena, 68);
assert.deepStrictEqual(screen.colaciones.columnas, [{ tipo: 'Colación sándwich', incluye: ['Sándwich pan grande + bebida 600 cc'] }]);
assert.deepStrictEqual(byName(screen.colaciones.filas, 'ORBIT').colaciones['Colación sándwich'], [
  { cantidad: 4, hora: '06:30', nota: '' }, { cantidad: 10, hora: '18:30', nota: 'Operadores noche' }
], 'bloques ordenados por hora');
assert.strictEqual(screen.colaciones.totales['Colación sándwich'], 14);
assert.strictEqual(screen.colaciones.filas.length, 1, 'en colaciones solo quien pidió colaciones');

console.log('screenCore OK');
