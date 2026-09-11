/**
 * Plazo de las 18:00 del día ANTERIOR a la fecha del servicio, en hora de Chile.
 * Se compara como string "YYYY-MM-DD HH:MM" en hora de Chile (vía Intl, que ya
 * resuelve el horario de verano de Chile correctamente) en vez de intentar construir
 * un instante UTC exacto — evita tener que calcular a mano el desfase de DST.
 */
function chileWallClock(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function daysBefore(fechaServicioIso, dias) {
  const [year, month, day] = fechaServicioIso.split('-').map(Number);
  const utcMidnight = new Date(Date.UTC(year, month - 1, day));
  const previous = new Date(utcMidnight.getTime() - dias * 24 * 60 * 60 * 1000);
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-${String(previous.getUTCDate()).padStart(2, '0')}`;
}

function dayBefore(fechaServicioIso) {
  return daysBefore(fechaServicioIso, 1);
}

/**
 * Días de anticipación exigidos, redondeados hacia arriba desde horas del contrato (48h -> 2 días).
 * Sin definir = 24h = el corte de "el día anterior" de siempre — compatible con todos los contratos existentes.
 */
function anticipationDays(horasAnticipacion) {
  const horas = Number(horasAnticipacion) > 0 ? Number(horasAnticipacion) : 24;
  return Math.max(1, Math.ceil(horas / 24));
}

/** true si "now" todavía está dentro del plazo para FechaServicio, con el HoraCierre del canal (default 18:00) y la anticipación del contrato (default 24h/1 día). */
function isWithinDeadline(fechaServicioIso, horaCierre, now, horasAnticipacion) {
  const deadline = `${daysBefore(fechaServicioIso, anticipationDays(horasAnticipacion))} ${horaCierre || '18:00'}`;
  return chileWallClock(now) <= deadline;
}

/** Fecha de mañana en el calendario de Chile (no UTC) — para el arrastre automático de las 18:05. */
function chileTomorrow(now) {
  const todayChile = chileWallClock(now).slice(0, 10);
  const [year, month, day] = todayChile.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day) + 24 * 60 * 60 * 1000);
  return `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, '0')}-${String(tomorrow.getUTCDate()).padStart(2, '0')}`;
}

module.exports = { chileWallClock, isWithinDeadline, chileTomorrow, anticipationDays };
