const assert = require('assert');
const { authorizedServices, isColacion, countsForSuggestion } = require('./serviceCatalog');

// El contrato tiene tarifas activas para Almuerzo y Cena, pero la modalidad es
// "Almuerzo a terreno" — Cena no debe aparecer aunque esté en el contrato, porque
// la modalidad define qué PREGUNTA el canal.
assert.deepStrictEqual(
  authorizedServices('Almuerzo a terreno', ['Almuerzo', 'Almuerzo hipocalórico', 'Cena', 'Hospedaje']),
  ['Almuerzo', 'Almuerzo hipocalórico']
);

// Si el contrato NO tiene tarifa activa para Cena hipocalórica, no debe autorizarse
// aunque la modalidad la contemple — la fuente real es el contrato, no la modalidad sola.
assert.deepStrictEqual(authorizedServices('Cena a terreno', ['Cena']), ['Cena']);

// Excepción explícita del canal agrega un servicio fuera de las tarifas activas.
assert.deepStrictEqual(
  authorizedServices('Almuerzo a terreno', ['Almuerzo'], '["Almuerzo hipocalórico"]'),
  ['Almuerzo', 'Almuerzo hipocalórico']
);

// Colación a terreno: reservada, nunca debe autorizar nada.
assert.deepStrictEqual(authorizedServices('Colación a terreno', ['Colación']), []);

// Solo las variantes de Colación se reparten en bloques por horario.
assert.strictEqual(isColacion('Colación'), true);
assert.strictEqual(isColacion('Colación desayuno reforzado'), true);
assert.strictEqual(isColacion('Almuerzo'), false);
assert.strictEqual(isColacion('Desayuno reforzado'), false);

console.log('Todas las pruebas de servicios autorizados pasaron.');

// «Sugerencias desde»: sin fecha cuenta todo lo anterior; con fecha, solo desde ese día (el historial no se borra).
assert.strictEqual(countsForSuggestion('2026-10-02T03:00:00Z', '2026-11-19', undefined), true);
assert.strictEqual(countsForSuggestion('2026-10-02T03:00:00Z', '2026-11-19', '2026-10-04T03:00:00Z'), false);
assert.strictEqual(countsForSuggestion('2026-10-04T03:00:00Z', '2026-11-19', '2026-10-04T03:00:00Z'), true);
assert.strictEqual(countsForSuggestion('2026-11-19T03:00:00Z', '2026-11-19', '2026-10-04'), false);
console.log('Pruebas de «Sugerencias desde» pasaron.');
