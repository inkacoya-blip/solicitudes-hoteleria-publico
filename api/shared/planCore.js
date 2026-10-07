const { chileWallClock, isWithinDeadline } = require('./time');
const { operatesOnWeekday, isColacion } = require('./serviceCatalog');

/**
 * Validación del "plan por plantilla": el cliente carga muchos días de una vez (un Excel).
 * Es lógica pura — sin red ni SharePoint — para poder probarla sola. El servidor la corre SIEMPRE,
 * aunque el navegador ya haya revisado el archivo: el navegador nunca es la autoridad.
 *
 * A diferencia de la solicitud diaria (hoy hasta +7 días), un plan puede mirar más lejos; el tope
 * evita archivos absurdos. Un día fuera de plazo NO se rechaza: igual que en la solicitud diaria,
 * queda como «Extraordinaria pendiente» de aceptación interna.
 */
const MAX_CANTIDAD = 500;
const MAX_DIAS = 62;
const MAX_FILAS = 300;
const MAX_ERRORES = 30;
const HORARIO_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayName(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return DIAS_SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * dias: [{ fecha: 'YYYY-MM-DD', servicios: [{ tipoServicio, cantidad, horario? }] }]
 * Devuelve { ok, errores, filas, dias, resumen }. Una casilla en blanco no llega aquí (el navegador
 * no la manda); un 0 sí es válido y significa «ese día NO quiero ese servicio».
 */
function validatePlan({ dias, permitted, now, horaCierre, horasAnticipacion, diasServicio, maxDias = MAX_DIAS, maxFilas = MAX_FILAS }) {
  const errores = [];
  const filas = [];
  const resumenDias = [];
  const addError = (message) => { if (errores.length < MAX_ERRORES) errores.push(message); };

  if (!Array.isArray(dias) || dias.length === 0) {
    return { ok: false, errores: ['La plantilla no trae ningún día con cantidades.'], filas, dias: resumenDias, resumen: { dias: 0, filas: 0, fueraDePlazo: 0, ceros: 0 } };
  }

  const today = chileWallClock(now).slice(0, 10);
  const horizon = addDaysIso(today, maxDias);
  const seen = new Set();

  dias.forEach((dia) => {
    const fecha = dia && dia.fecha;
    if (!isValidDateString(fecha)) { addError(`Fecha no válida: «${String(fecha).slice(0, 30)}».`); return; }
    if (fecha < today) { addError(`El ${fecha} ya pasó: no se puede pedir con este archivo.`); return; }
    if (fecha > horizon) { addError(`El ${fecha} está muy lejos: se puede planificar hasta ${maxDias} días hacia adelante.`); return; }

    const servicios = Array.isArray(dia.servicios) ? dia.servicios : [];
    const detalle = [];
    let diaFueraDePlazo = false;

    servicios.forEach((item) => {
      const tipoServicio = item && item.tipoServicio;
      const cantidad = Number(item && item.cantidad);
      const colacion = isColacion(tipoServicio);
      const horario = colacion && typeof item.horario === 'string' ? item.horario.trim() : '';

      if (!permitted.includes(tipoServicio)) { addError(`El servicio «${String(tipoServicio).slice(0, 40)}» no está autorizado en este contrato.`); return; }
      if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > MAX_CANTIDAD) { addError(`${fecha} · ${tipoServicio}: la cantidad debe ser un número entero entre 0 y ${MAX_CANTIDAD}.`); return; }
      if (colacion && !HORARIO_PATTERN.test(horario)) { addError(`${fecha} · ${tipoServicio}: falta el horario (formato HH:MM, por ejemplo 06:30).`); return; }
      if (cantidad > 0 && !operatesOnWeekday(diasServicio, fecha)) { addError(`El contrato no presta servicio el ${weekdayName(fecha)} ${fecha}.`); return; }

      const key = `${fecha}|${tipoServicio}|${horario}`;
      if (seen.has(key)) { addError(`${fecha} · ${tipoServicio}${horario ? ` ${horario}` : ''}: está repetido en el archivo.`); return; }
      seen.add(key);

      const fueraDePlazo = !isWithinDeadline(fecha, horaCierre, now, horasAnticipacion);
      if (fueraDePlazo) diaFueraDePlazo = true;
      filas.push({ fecha, tipoServicio, cantidad, horario: horario || undefined, fueraDePlazo });
      detalle.push({ tipoServicio, cantidad, horario: horario || undefined });
    });

    if (detalle.length > 0) resumenDias.push({ fecha, estado: diaFueraDePlazo ? 'fuera-de-plazo' : 'en-plazo', servicios: detalle });
  });

  if (filas.length === 0 && errores.length === 0) addError('La plantilla no trae ninguna cantidad.');
  if (filas.length > maxFilas) addError(`El archivo trae demasiadas filas (${filas.length}); el máximo es ${maxFilas}. Súbelo en partes.`);

  resumenDias.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  return {
    ok: errores.length === 0,
    errores,
    filas,
    dias: resumenDias,
    resumen: {
      dias: resumenDias.length,
      filas: filas.length,
      fueraDePlazo: filas.filter((fila) => fila.fueraDePlazo).length,
      ceros: filas.filter((fila) => fila.cantidad === 0).length
    }
  };
}

module.exports = { validatePlan, MAX_DIAS, MAX_FILAS, MAX_CANTIDAD };
