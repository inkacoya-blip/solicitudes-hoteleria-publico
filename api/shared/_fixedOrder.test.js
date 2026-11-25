const assert = require('assert');
const { fixedOrderLinesFor, contractTakesFixedOrder } = require('./fixedOrder');

// Lavandería: 2 almuerzos de domingo a miércoles y 2 colaciones todos los días.
const pedido = JSON.stringify([
  { TipoServicio: 'Almuerzo', Cantidad: 2, Dias: ['Lunes', 'Martes', 'Miércoles', 'Domingo'] },
  { TipoServicio: 'Colación', Cantidad: 2, Dias: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] }
]);

// 2026-11-26 es jueves; 2026-11-29 es domingo.
assert.deepStrictEqual(fixedOrderLinesFor(pedido, '2026-11-26').map((l) => l.TipoServicio), ['Colación'], 'jueves: solo colación');
assert.deepStrictEqual(fixedOrderLinesFor(pedido, '2026-11-29').map((l) => l.TipoServicio), ['Almuerzo', 'Colación'], 'domingo: almuerzo y colación');
assert.deepStrictEqual(fixedOrderLinesFor('no es json', '2026-11-29'), []);

const base = { Estado: 'Pendiente de firma', FechaInicio: '2026-10-23T12:00:00Z', PedidoFijo: pedido };
assert.strictEqual(contractTakesFixedOrder(base, '2026-11-26'), true, 'pendiente de firma ya opera');
assert.strictEqual(contractTakesFixedOrder({ ...base, Estado: 'Suspendido' }, '2026-11-26'), false);
assert.strictEqual(contractTakesFixedOrder({ ...base, FechaTermino: '2026-11-25T12:00:00Z' }, '2026-11-26'), false);
assert.strictEqual(contractTakesFixedOrder({ ...base, PedidoFijo: undefined }, '2026-11-26'), false);

console.log('Todas las pruebas de pedido fijo pasaron.');
