const assert = require('assert');
const { validatePlan } = require('./planCore');

// "Ahora": martes 13-10-2026, 10:00 hora de Chile (UTC-3 en horario de verano; el cálculo usa Intl, así que basta una hora segura del día).
const now = new Date('2026-10-13T13:00:00Z');
const base = {
  permitted: ['Desayuno', 'Almuerzo', 'Cena', 'Colación'],
  now,
  horaCierre: '18:00',
  horasAnticipacion: undefined,
  diasServicio: undefined
};
const plan = (dias, extra) => validatePlan({ ...base, ...extra, dias });

// Caso feliz: dos días con servicios; el resumen cuenta días, filas y ceros.
{
  const r = plan([
    { fecha: '2026-10-20', servicios: [{ tipoServicio: 'Desayuno', cantidad: 4 }, { tipoServicio: 'Cena', cantidad: 0 }] },
    { fecha: '2026-10-21', servicios: [{ tipoServicio: 'Almuerzo', cantidad: 6 }] }
  ]);
  assert.strictEqual(r.ok, true, JSON.stringify(r.errores));
  assert.deepStrictEqual(r.resumen, { dias: 2, filas: 3, fueraDePlazo: 0, ceros: 1 });
  assert.strictEqual(r.dias[0].estado, 'en-plazo');
}

// Un 0 explícito es válido (significa "ese día NO quiero ese servicio").
{
  const r = plan([{ fecha: '2026-10-22', servicios: [{ tipoServicio: 'Cena', cantidad: 0 }] }]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.filas[0].cantidad, 0);
}

// Un día pasado no se acepta.
{
  const r = plan([{ fecha: '2026-10-12', servicios: [{ tipoServicio: 'Desayuno', cantidad: 2 }] }]);
  assert.strictEqual(r.ok, false);
  assert.ok(/ya pasó/.test(r.errores[0]));
}

// Más allá del horizonte tampoco (62 días desde hoy).
{
  const r = plan([{ fecha: '2026-12-31', servicios: [{ tipoServicio: 'Desayuno', cantidad: 2 }] }]);
  assert.strictEqual(r.ok, false);
  assert.ok(/muy lejos/.test(r.errores[0]));
}

// Mañana, después de las 18:00 de hoy: queda fuera de plazo (pendiente de aceptación), NO se rechaza.
{
  const tarde = new Date('2026-10-13T22:00:00Z'); // 19:00 en Chile
  const r = validatePlan({ ...base, now: tarde, dias: [{ fecha: '2026-10-14', servicios: [{ tipoServicio: 'Desayuno', cantidad: 3 }] }] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.resumen.fueraDePlazo, 1);
  assert.strictEqual(r.dias[0].estado, 'fuera-de-plazo');
}

// Con 48 horas de anticipación el mismo "mañana" ya está fuera de plazo desde la mañana.
{
  const r = validatePlan({ ...base, horasAnticipacion: 48, dias: [{ fecha: '2026-10-14', servicios: [{ tipoServicio: 'Desayuno', cantidad: 3 }] }] });
  assert.strictEqual(r.resumen.fueraDePlazo, 1);
}

// Servicio no autorizado: se rechaza todo el archivo (nunca se acepta a medias en silencio).
{
  const r = plan([{ fecha: '2026-10-20', servicios: [{ tipoServicio: 'Hospedaje', cantidad: 2 }] }]);
  assert.strictEqual(r.ok, false);
  assert.ok(/no está autorizado/.test(r.errores[0]));
}

// Cantidades inválidas: negativa, decimal, texto, sobre el tope.
for (const cantidad of [-1, 2.5, 'abc', 501]) {
  const r = plan([{ fecha: '2026-10-20', servicios: [{ tipoServicio: 'Desayuno', cantidad }] }]);
  assert.strictEqual(r.ok, false, `cantidad ${cantidad} debía rechazarse`);
}

// Colación exige horario HH:MM; los demás servicios ignoran el horario.
{
  const sin = plan([{ fecha: '2026-10-20', servicios: [{ tipoServicio: 'Colación', cantidad: 10 }] }]);
  assert.strictEqual(sin.ok, false);
  const mal = plan([{ fecha: '2026-10-20', servicios: [{ tipoServicio: 'Colación', cantidad: 10, horario: '25:99' }] }]);
  assert.strictEqual(mal.ok, false);
  const bien = plan([{ fecha: '2026-10-20', servicios: [{ tipoServicio: 'Colación', cantidad: 10, horario: '06:30' }, { tipoServicio: 'Colación', cantidad: 5, horario: '18:30' }] }]);
  assert.strictEqual(bien.ok, true);
  assert.strictEqual(bien.filas.length, 2);
  const ignorado = plan([{ fecha: '2026-10-20', servicios: [{ tipoServicio: 'Desayuno', cantidad: 4, horario: 'cualquier cosa' }] }]);
  assert.strictEqual(ignorado.ok, true);
  assert.strictEqual(ignorado.filas[0].horario, undefined);
}

// El contrato solo presta servicio ciertos días: pedir cantidad un día sin servicio es error; un 0 no.
{
  const dias = JSON.stringify(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']);
  const sabado = '2026-10-17';
  const conCantidad = plan([{ fecha: sabado, servicios: [{ tipoServicio: 'Desayuno', cantidad: 3 }] }], { diasServicio: dias });
  assert.strictEqual(conCantidad.ok, false);
  assert.ok(/no presta servicio/.test(conCantidad.errores[0]));
  const conCero = plan([{ fecha: sabado, servicios: [{ tipoServicio: 'Desayuno', cantidad: 0 }] }], { diasServicio: dias });
  assert.strictEqual(conCero.ok, true);
}

// Repetidos, fechas inválidas y archivo vacío.
{
  const dup = plan([{ fecha: '2026-10-20', servicios: [{ tipoServicio: 'Desayuno', cantidad: 2 }, { tipoServicio: 'Desayuno', cantidad: 3 }] }]);
  assert.strictEqual(dup.ok, false);
  assert.ok(/repetido/.test(dup.errores[0]));
  assert.strictEqual(plan([{ fecha: '2026-02-30', servicios: [{ tipoServicio: 'Desayuno', cantidad: 2 }] }]).ok, false);
  assert.strictEqual(plan([]).ok, false);
  assert.strictEqual(plan([{ fecha: '2026-10-20', servicios: [] }]).ok, false);
}

// Tope de filas y de mensajes de error.
{
  const muchos = [];
  for (let i = 0; i < 40; i += 1) muchos.push({ fecha: `2026-10-${String(14 + (i % 17)).padStart(2, '0')}`, servicios: [{ tipoServicio: 'Hospedaje', cantidad: 1 }] });
  const r = plan(muchos);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errores.length <= 30);
  const filas = [];
  for (let i = 0; i < 20; i += 1) {
    const dia = String(14 + i).padStart(2, '0');
    filas.push({ fecha: `2026-10-${dia}`, servicios: ['Desayuno', 'Almuerzo', 'Cena'].map((t) => ({ tipoServicio: t, cantidad: 1 })) });
  }
  assert.strictEqual(validatePlan({ ...base, dias: filas, maxFilas: 10 }).ok, false);
}

console.log('Todas las pruebas del plan por plantilla pasaron.');
