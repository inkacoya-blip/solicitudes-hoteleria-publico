/**
 * Lógica pura de la app del celular de hospedaje (camareras, supervisoras, recepción).
 * Sin red ni SharePoint: todo lo que se pueda equivocar en las reglas vive acá y se prueba aparte.
 */
const crypto = require('crypto');
const { chileWallClock } = require('./time');

const OCUPACIONES = ['Ocupada', 'Vacía', 'Sale hoy'];
const TIPOS_DANO = ['Desgaste', 'Posible mal uso'];
const ROLES_SUPERVISION = ['Supervisora'];
/** Personal que solo sube las hojas BPM de su área (cocina, casino, bodega y reparto): no ve casas ni piezas. */
const ROLES_SOLO_BPM = ['Cocina', 'Garzón', 'Auxiliar de casino', 'Bodega', 'Conductor'];

/** Insumos que se pueden pedir con un toque. No hay toallas (decisión de Francisca). «Otro» abre texto libre. */
const SUPPLY_CATALOG = [
  'Papel higiénico',
  'Jabón de manos',
  'Shampoo',
  'Detergente',
  'Cloro',
  'Desinfectante',
  'Bolsas de basura',
  'Sábanas',
  'Fundas de almohada',
  'Frazadas',
  'Esponjas y paños',
  'Otro'
];

const MAX_PERSONAS = 20;
const MAX_SUPPLY_LINES = 15;
const SUPERVISOR_LOOKBACK_DAYS = 14;
const STAFF_LOOKBACK_DAYS = 1;
const CARRY_OVER_DAYS = 7;

function chileToday(now) {
  return chileWallClock(now || new Date()).slice(0, 10);
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day) + days * 86400000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function daysBetween(fromIso, toIso) {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

/** 2026-11-05 -> 20261105: columna numérica e indexada del parte; permite filtrar por día en SharePoint sin filtros de fecha. */
function dayNumber(iso) {
  return Number(iso.replace(/-/g, ''));
}

function isSupervision(rol) {
  return ROLES_SUPERVISION.includes(rol);
}

function isSoloBpm(rol) {
  return ROLES_SOLO_BPM.includes(rol);
}

/** Quién puede subir hojas BPM: la supervisora y el personal de cocina, casino, bodega y reparto. */
function canBpm(rol) {
  return isSupervision(rol) || isSoloBpm(rol);
}

/** La camarera registra hoy (y ayer, por si cerró el turno tarde); la supervisora puede revisar y corregir hasta 14 días atrás. Nunca el futuro. */
function checkWorkDate(rol, fecha, today) {
  if (!isIsoDate(fecha)) return { ok: false, message: 'La fecha no es válida.' };
  const back = daysBetween(fecha, today);
  if (back < 0) return { ok: false, message: 'No se puede registrar un día que todavía no llega.' };
  const limit = isSupervision(rol) ? SUPERVISOR_LOOKBACK_DAYS : STAFF_LOOKBACK_DAYS;
  if (back > limit) {
    return { ok: false, message: isSupervision(rol) ? 'Ese día es muy antiguo para corregirlo desde el celular.' : 'Solo se puede registrar hoy o ayer. Pídele a la supervisora que lo corrija.' };
  }
  return { ok: true };
}

/** Orden natural de números de pieza: 2 antes que 10, 3A después de 3. */
function compareRoomNumbers(a, b) {
  const split = (value) => {
    const match = /^(\d+)(.*)$/.exec(String(value).trim());
    return match ? { n: Number(match[1]), rest: match[2].toLowerCase() } : { n: Number.MAX_SAFE_INTEGER, rest: String(value).toLowerCase() };
  };
  const left = split(a);
  const right = split(b);
  if (left.n !== right.n) return left.n - right.n;
  return left.rest < right.rest ? -1 : left.rest > right.rest ? 1 : 0;
}

function toBool(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function toInt(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d{1,3}$/.test(value.trim())) return Number(value.trim());
  return NaN;
}

/**
 * Valida lo que manda el celular para UNA pieza y devuelve los campos listos para guardar.
 * allowedContractIds = contratos realmente vinculados a la casa ese día: el celular nunca decide
 * un contrato que la casa no tiene.
 */
function normalizeRoomInput(input, room, allowedContractIds) {
  const raw = input || {};
  const ocupacion = OCUPACIONES.includes(raw.ocupacion) ? raw.ocupacion : '';
  if (!ocupacion) return { ok: false, message: 'Falta indicar si la pieza está ocupada, vacía o si sale hoy.' };

  const observacion = typeof raw.observacion === 'string' ? raw.observacion.trim().slice(0, 500) : '';
  const flags = {
    LimpiezaDiaria: toBool(raw.limpiezaDiaria),
    CambioSabanas: toBool(raw.cambioSabanas),
    AseoFondo: toBool(raw.aseoFondo),
    SinDanos: toBool(raw.sinDanos)
  };

  if (ocupacion === 'Vacía') {
    return { ok: true, value: { Ocupacion: ocupacion, ContratoId: null, Personas: 0, Camas: 0, ...flags, Observacion: observacion } };
  }

  const contratoId = Number(raw.contratoId);
  if (!Number.isInteger(contratoId) || !allowedContractIds.includes(contratoId)) {
    return { ok: false, message: 'Falta elegir la empresa o contrato que ocupa la pieza.' };
  }
  const personas = toInt(raw.personas);
  if (!Number.isInteger(personas) || personas < 1 || personas > MAX_PERSONAS) {
    return { ok: false, message: 'Indica cuántas personas hay en la pieza (de 1 a 20).' };
  }
  const maxBeds = room && Number(room.Camas) > 0 ? Number(room.Camas) : MAX_PERSONAS;
  const camas = toInt(raw.camas);
  if (!Number.isInteger(camas) || camas < 1 || camas > maxBeds) {
    return { ok: false, message: `Las camas usadas deben ser entre 1 y ${maxBeds}.` };
  }
  return { ok: true, value: { Ocupacion: ocupacion, ContratoId: contratoId, Personas: personas, Camas: camas, ...flags, Observacion: observacion } };
}

const FIELD_LABELS = {
  Ocupacion: 'Ocupación',
  ContratoId: 'Contrato',
  Personas: 'Personas',
  Camas: 'Camas usadas',
  LimpiezaDiaria: 'Limpieza diaria',
  CambioSabanas: 'Cambio de sábanas',
  AseoFondo: 'Aseo a fondo',
  SinDanos: 'Sin daños',
  Observacion: 'Observación'
};

function displayValue(field, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return String(value);
}

/** Qué cambió entre lo guardado y lo nuevo (para la bitácora de cambios). Lista vacía = no hay nada que anotar. */
function diffRoomLog(previousFields, nextValue) {
  const changes = [];
  Object.keys(FIELD_LABELS).forEach((field) => {
    const before = previousFields[field] === undefined || previousFields[field] === null ? null : previousFields[field];
    const after = nextValue[field] === undefined || nextValue[field] === null ? null : nextValue[field];
    const normalizedBefore = typeof after === 'boolean' ? Boolean(before) : before;
    if ((normalizedBefore === null ? '' : normalizedBefore) === (after === null ? '' : after)) return;
    changes.push({ campo: FIELD_LABELS[field], anterior: displayValue(field, normalizedBefore), nuevo: displayValue(field, after) });
  });
  return changes;
}

/** Lo que la pieza «probablemente sigue siendo» hoy según el último parte conocido. Es solo una sugerencia: no se guarda hasta que alguien confirma. */
function suggestFromPrevious(previousFields) {
  if (!previousFields) return null;
  if (previousFields.Ocupacion === 'Ocupada') {
    return {
      ocupacion: 'Ocupada',
      contratoId: previousFields.ContratoId === undefined ? null : previousFields.ContratoId,
      personas: previousFields.Personas === undefined ? null : previousFields.Personas,
      camas: previousFields.Camas === undefined ? null : previousFields.Camas
    };
  }
  return { ocupacion: 'Vacía', contratoId: null, personas: 0, camas: 0 };
}

/** De varios días, deja el parte MÁS RECIENTE de cada pieza (los pares {pieza → campos}). */
function latestLogPerRoom(logs) {
  const byRoom = new Map();
  logs.forEach((log) => {
    const roomId = Number(log.fields.PiezaId);
    const current = byRoom.get(roomId);
    if (!current || Number(log.fields.Dia) > Number(current.fields.Dia)) byRoom.set(roomId, log);
  });
  return byRoom;
}

/**
 * Revisión al azar «por camarera»: hasta N piezas de cada persona que registró ese día, elegidas por un
 * orden fijo a partir de la fecha (no cambia si se recarga la pantalla ni depende de a quién le toque verla).
 */
function pickReviewSample(logs, fecha, perPerson) {
  const limit = perPerson || 3;
  const byPerson = new Map();
  logs.forEach((log) => {
    const person = String(log.fields.RegistradoPor || '');
    if (!byPerson.has(person)) byPerson.set(person, []);
    byPerson.get(person).push(log);
  });
  const picked = new Set();
  byPerson.forEach((items) => {
    items
      .map((log) => ({ id: Number(log.fields.PiezaId), key: crypto.createHash('sha256').update(`${fecha}|${log.fields.PiezaId}`).digest('hex') }))
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .slice(0, limit)
      .forEach((item) => picked.add(item.id));
  });
  return picked;
}

/** Valida el pedido de insumos y lo deja como texto legible para Bodega: «Papel higiénico × 4». */
function formatSupplyRequest(items) {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, message: 'Agrega al menos un insumo al pedido.' };
  if (items.length > MAX_SUPPLY_LINES) return { ok: false, message: 'El pedido tiene demasiadas líneas. Divídelo en dos.' };
  const lines = [];
  for (const item of items) {
    const articulo = item && typeof item.articulo === 'string' ? item.articulo.trim() : '';
    const cantidad = toInt(item && item.cantidad);
    if (!SUPPLY_CATALOG.includes(articulo)) return { ok: false, message: 'Hay un insumo que no está en la lista.' };
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99) return { ok: false, message: 'La cantidad de cada insumo debe ser entre 1 y 99.' };
    if (articulo === 'Otro') {
      const detalle = typeof item.detalle === 'string' ? item.detalle.trim().slice(0, 120) : '';
      if (!detalle) return { ok: false, message: 'En «Otro» escribe qué insumo necesitas.' };
      lines.push(`${detalle} × ${cantidad}`);
    } else {
      lines.push(`${articulo} × ${cantidad}`);
    }
  }
  return { ok: true, detail: lines.join('\n') };
}

function staffLabel(fields) {
  return `${fields.Codigo} · ${fields.Title}`;
}

/** Contratos que valen para esa casa ese día: vínculo activo en la fecha y contrato no terminado ni suspendido. */
function activeContractLinks(links, fecha) {
  return links.filter((link) => {
    const from = (link.fields.FechaDesde || '').slice(0, 10);
    const to = (link.fields.FechaHasta || '').slice(0, 10);
    if (from && from > fecha) return false;
    if (to && to < fecha) return false;
    return true;
  });
}

/* ---------- Registros BPM (hojas de temperatura, higiene y limpieza) ---------- */

const BPM_TURNOS = ['Mañana', 'Tarde', 'Noche'];
const BPM_RESULTADOS = { ok: 'Conforme', fuera: 'Fuera de límite' };
const BPM_TEMP_MIN = -60;
const BPM_TEMP_MAX = 400;

/** Lee un formato del catálogo (fila de ICH_BPM_FORMATOS) y deja sus puntos de control ya limpios. */
function parseBpmFormat(item) {
  const fields = item.fields || {};
  let puntos = [];
  try {
    const parsed = JSON.parse(fields.Puntos || '[]');
    if (Array.isArray(parsed)) {
      puntos = parsed
        .filter((p) => p && typeof p.nombre === 'string' && p.nombre.trim() !== '')
        .map((p) => ({
          nombre: p.nombre.trim(),
          min: Number.isFinite(Number(p.min)) && p.min !== null && p.min !== undefined && p.min !== '' ? Number(p.min) : undefined,
          max: Number.isFinite(Number(p.max)) && p.max !== null && p.max !== undefined && p.max !== '' ? Number(p.max) : undefined
        }));
    }
  } catch (error) { puntos = []; }
  return {
    id: Number(item.id),
    codigo: String(fields.Codigo || ''),
    nombre: String(fields.Title || ''),
    area: String(fields.Area || ''),
    frecuencia: String(fields.Frecuencia || ''),
    tomas: Number(fields.TomasPorDia || 0),
    tipo: fields.Tipo === 'Temperatura' ? 'Temperatura' : 'Cumple',
    puntos,
    instruccion: String(fields.Instruccion || ''),
    activo: fields.Activo !== false,
    orden: Number(fields.Orden || 0)
  };
}

/** Un número con coma o punto; vacío o basura = undefined. */
function toNumberOrUndefined(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Revisa lo que anotó la supervisora contra los límites del formato. El celular solo muestra: el resultado
 * («Conforme» o «Fuera de límite») lo decide siempre el servidor.
 * Devuelve { ok:true, value } con las columnas listas para guardar, o { ok:false, message }.
 */
function evaluateBpm(format, input) {
  const turno = BPM_TURNOS.includes(input.turno) ? input.turno : '';
  const lugar = typeof input.lugar === 'string' ? input.lugar.trim().slice(0, 120) : '';
  const observacion = typeof input.observacion === 'string' ? input.observacion.trim().slice(0, 1000) : '';
  const base = { Turno: turno, Lugar: lugar };
  let fuera = false;

  if (format.tipo === 'Temperatura') {
    const point = format.puntos.find((p) => p.nombre === input.punto);
    if (!point) return { ok: false, message: 'Elige qué se midió.' };
    const min = toNumberOrUndefined(input.minimo);
    const max = toNumberOrUndefined(input.maximo);
    const manual = input.fuera === true;
    if (!manual && (min === undefined || max === undefined)) return { ok: false, message: 'Anota la temperatura mínima y la máxima que se leyeron, o marca «Fuera de límite».' };
    for (const value of [min, max]) {
      if (value !== undefined && (value < BPM_TEMP_MIN || value > BPM_TEMP_MAX)) return { ok: false, message: 'Esa temperatura no parece correcta. Revísala.' };
    }
    if (min !== undefined && max !== undefined && min > max) return { ok: false, message: 'La mínima no puede ser mayor que la máxima.' };
    if (min !== undefined && point.min !== undefined && min < point.min) fuera = true;
    if (max !== undefined && point.max !== undefined && max > point.max) fuera = true;
    if (manual) fuera = true;
    base.Punto = point.nombre;
    if (min !== undefined) base.Minimo = min;
    if (max !== undefined) base.Maximo = max;
  } else {
    if (typeof input.cumple !== 'boolean') return { ok: false, message: 'Indica si cumple o no cumple.' };
    fuera = input.cumple === false;
    base.Punto = '';
  }

  if (fuera && observacion.length < 5) return { ok: false, message: 'Está fuera de límite: anota qué se hizo (por ejemplo, se recalentó o se eliminó el producto).' };
  return {
    ok: true,
    value: { ...base, Resultado: fuera ? BPM_RESULTADOS.fuera : BPM_RESULTADOS.ok, Observacion: observacion, AccionEstado: fuera ? 'Pendiente' : 'No aplica' }
  };
}

module.exports = {
  BPM_TURNOS,
  BPM_RESULTADOS,
  parseBpmFormat,
  evaluateBpm,
  OCUPACIONES,
  TIPOS_DANO,
  SUPPLY_CATALOG,
  CARRY_OVER_DAYS,
  chileToday,
  isIsoDate,
  addDays,
  daysBetween,
  dayNumber,
  isSupervision,
  isSoloBpm,
  canBpm,
  checkWorkDate,
  compareRoomNumbers,
  normalizeRoomInput,
  diffRoomLog,
  suggestFromPrevious,
  latestLogPerRoom,
  pickReviewSample,
  formatSupplyRequest,
  staffLabel,
  activeContractLinks
};
