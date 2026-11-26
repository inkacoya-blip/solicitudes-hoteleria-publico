const assert = require('assert');
const { horarioFormFor, horarioFormServices } = require('./horarioForm');

const json = JSON.stringify({
  desde: '2026-12-01',
  servicios: [
    { tipo: 'Desayuno', horas: ['06:30', '07:00'] },
    { tipo: 'Colación hídrica', nombre: 'Colación MECAMIN', horas: ['06:30', 'mal'] },
    { tipo: 'Colación', nombre: 'Colación administrativa MECAMIN', horas: [] },
    { tipo: 'Cena hipocalórica', horas: ['19:00'] }
  ]
});

assert.strictEqual(horarioFormFor(json, '2026-11-30'), null, 'antes del 01-12 rige el formulario de siempre');
const config = horarioFormFor(json, '2026-12-01');
assert.ok(config, 'desde el 01-12 rige el formulario por horario');
assert.strictEqual(config.servicios[0].nombre, 'Desayuno', 'sin nombre usa el tipo');
assert.deepStrictEqual(config.servicios[1].horas, ['06:30'], 'descarta horas mal escritas');
assert.deepStrictEqual(
  horarioFormServices(config, ['Desayuno', 'Colación hídrica', 'Colación', 'Colación sándwich']),
  ['Desayuno', 'Colación hídrica', 'Colación'],
  'solo los configurados y autorizados; la Colación sándwich sale'
);
assert.strictEqual(horarioFormFor('no es json', '2026-12-01'), null);
assert.strictEqual(horarioFormFor(undefined, '2026-12-01'), null);

console.log('Todas las pruebas de formulario por horario pasaron.');
