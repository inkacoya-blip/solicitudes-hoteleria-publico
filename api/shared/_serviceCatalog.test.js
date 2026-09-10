const assert = require('assert');
const { authorizedServices } = require('./serviceCatalog');

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

console.log('Todas las pruebas de servicios autorizados pasaron.');
