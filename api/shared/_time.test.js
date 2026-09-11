const assert = require('assert');
const { isWithinDeadline, chileWallClock, chileTomorrow, anticipationDays } = require('./time');

// Verificado con Intl directamente (ver salida de consola): el 10-sep-2026 Chile YA
// está en horario de verano (GMT-3), no GMT-4 — confirma por qué no hay que asumir
// el offset a mano. Servicio del 11-sep: plazo vence el 10-sep 18:00 Chile = 21:00 UTC.
const before = new Date('2026-09-10T20:59:00Z'); // 17:59 Chile (GMT-3)
const atDeadline = new Date('2026-09-10T21:00:00Z'); // 18:00 Chile exacto
const after = new Date('2026-09-10T21:01:00Z'); // 18:01 Chile

assert.strictEqual(isWithinDeadline('2026-09-11', '18:00', before), true, 'antes del plazo debe ser válido');
assert.strictEqual(isWithinDeadline('2026-09-11', '18:00', atDeadline), true, 'justo en el plazo debe ser válido');
assert.strictEqual(isWithinDeadline('2026-09-11', '18:00', after), false, 'después del plazo debe ser inválido');

// Horario de invierno (GMT-4): julio 2026. Servicio 11-jul, plazo 10-jul 18:00 Chile = 22:00 UTC.
assert.strictEqual(isWithinDeadline('2026-07-11', '18:00', new Date('2026-07-10T21:59:00Z')), true, 'invierno: antes del plazo');
assert.strictEqual(isWithinDeadline('2026-07-11', '18:00', new Date('2026-07-10T22:01:00Z')), false, 'invierno: después del plazo');

// Cruce de mes: servicio 1-oct, plazo vence 30-sep 18:00 Chile (GMT-3 = 21:00 UTC).
assert.strictEqual(isWithinDeadline('2026-10-01', '18:00', new Date('2026-09-30T20:59:00Z')), true);
assert.strictEqual(isWithinDeadline('2026-10-01', '18:00', new Date('2026-09-30T21:01:00Z')), false);

console.log('chileWallClock(2026-09-10T22:00:00Z) =', chileWallClock(new Date('2026-09-10T22:00:00Z')));
console.log('Todas las pruebas de plazo pasaron.');

// Anticipación configurable por contrato (ej. Asmin: 48h -> 2 días, no el corte de 1 día de siempre).
assert.strictEqual(anticipationDays(undefined), 1, 'sin definir = 24h = 1 día, compatible con contratos existentes');
assert.strictEqual(anticipationDays(24), 1);
assert.strictEqual(anticipationDays(48), 2);
assert.strictEqual(anticipationDays(36), 2, 'redondea hacia arriba');

// Servicio 13-sep, 48h de anticipación -> plazo vence 11-sep 18:00 Chile (GMT-3 = 21:00 UTC).
assert.strictEqual(isWithinDeadline('2026-09-13', '18:00', new Date('2026-09-11T20:59:00Z'), 48), true, '48h: antes del plazo');
assert.strictEqual(isWithinDeadline('2026-09-13', '18:00', new Date('2026-09-11T21:01:00Z'), 48), false, '48h: después del plazo');
// El mismo envío, sin el parámetro de anticipación (comportamiento de siempre: 1 día antes, plazo vence el 12-sep),
// todavía estaría dentro de plazo — la diferencia real la hacen las 48h exigidas por el contrato de Asmin.
assert.strictEqual(isWithinDeadline('2026-09-13', '18:00', new Date('2026-09-11T21:01:00Z')), true);
console.log('Todas las pruebas de anticipación configurable pasaron.');

// chileTomorrow — usado por el arrastre automático de las 18:05.
assert.strictEqual(chileTomorrow(new Date('2026-09-10T23:55:00Z')), '2026-09-11');
assert.strictEqual(chileTomorrow(new Date('2026-09-30T23:55:00Z')), '2026-10-01', 'cruce de mes');
// 2026-09-11T02:59:00Z = 2026-09-10 23:59 Chile (GMT-3) -> "hoy" en Chile sigue siendo 10-sep.
assert.strictEqual(chileTomorrow(new Date('2026-09-11T02:59:00Z')), '2026-09-11');
console.log('Todas las pruebas de chileTomorrow pasaron.');
