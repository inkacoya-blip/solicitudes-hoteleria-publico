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

function dayBefore(fechaServicioIso) {
  const [year, month, day] = fechaServicioIso.split('-').map(Number);
  const utcMidnight = new Date(Date.UTC(year, month - 1, day));
  const previous = new Date(utcMidnight.getTime() - 24 * 60 * 60 * 1000);
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-${String(previous.getUTCDate()).padStart(2, '0')}`;
}

/** true si "now" todavía está dentro del plazo para FechaServicio, con el HoraCierre del canal (default 18:00). */
function isWithinDeadline(fechaServicioIso, horaCierre, now) {
  const deadline = `${dayBefore(fechaServicioIso)} ${horaCierre || '18:00'}`;
  return chileWallClock(now) <= deadline;
}

/** Fecha de mañana en el calendario de Chile (no UTC) — para el arrastre automático de las 18:05. */
function chileTomorrow(now) {
  const todayChile = chileWallClock(now).slice(0, 10);
  const [year, month, day] = todayChile.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day) + 24 * 60 * 60 * 1000);
  return `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, '0')}-${String(tomorrow.getUTCDate()).padStart(2, '0')}`;
}

module.exports = { chileWallClock, isWithinDeadline, chileTomorrow };
