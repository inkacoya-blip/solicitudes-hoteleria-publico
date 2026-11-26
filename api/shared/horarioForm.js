/**
 * Formulario por horario de un contrato (ICH_CONTRATOS.FormularioPorHorario, JSON). Ej. Mecamin desde 01-12-2026:
 * { "desde": "2026-12-01", "servicios": [ { "tipo": "Colación hídrica", "nombre": "Colación MECAMIN", "horas": ["06:30","18:00"] }, … ] }
 * Desde «desde» (fecha del servicio), el formulario muestra SOLO esos servicios, con su nombre, y TODOS se piden
 * en bloques de hora + cantidad + observación (como las colaciones). Antes de esa fecha rige el formulario de siempre.
 * Mismo formato que lee el ERP (horarioFormCore.ts): deben coincidir.
 */
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseHorarioForm(json) {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.servicios)) return null;
    const servicios = parsed.servicios
      .filter((s) => s && typeof s.tipo === 'string' && s.tipo.trim() !== '')
      .map((s) => ({
        tipo: s.tipo.trim(),
        nombre: typeof s.nombre === 'string' && s.nombre.trim() !== '' ? s.nombre.trim() : s.tipo.trim(),
        horas: Array.isArray(s.horas) ? s.horas.filter((h) => typeof h === 'string' && HORA.test(h)) : []
      }));
    if (servicios.length === 0) return null;
    const desde = typeof parsed.desde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.desde) ? parsed.desde : '';
    return { desde, servicios };
  } catch {
    return null;
  }
}

/** La configuración si rige para esa fecha de servicio; null = formulario de siempre. */
function horarioFormFor(json, fechaIso) {
  const config = parseHorarioForm(json);
  if (!config) return null;
  if (config.desde && String(fechaIso).slice(0, 10) < config.desde) return null;
  return config;
}

/** Servicios del formulario: los configurados que además estén autorizados (tarifa activa ∩ modalidad), en el orden configurado. */
function horarioFormServices(config, permitted) {
  return config.servicios.filter((s) => permitted.includes(s.tipo)).map((s) => s.tipo);
}

module.exports = { parseHorarioForm, horarioFormFor, horarioFormServices };
