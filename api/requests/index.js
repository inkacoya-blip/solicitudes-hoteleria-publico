const { hashToken } = require('../shared/hash');
const { isWithinDeadline, chileWallClock } = require('../shared/time');
const { authorizedServices } = require('../shared/serviceCatalog');
const { sendJson } = require('../shared/respond');
const {
  findChannelByTokenHash,
  getContractServiceLabel,
  getActiveContractServiceTypes,
  findByClaveFila,
  createServiceRequest,
  logRejectedAttempt,
  countRecentAttempts
} = require('../shared/repository');

const GENERIC_INVALID = { ok: false, message: 'No fue posible registrar la solicitud.' };
const GENERIC_OK = { ok: true, message: 'Solicitud registrada.' };
const MAX_CANTIDAD = 500;
const RATE_LIMIT_WINDOW_MINUTES = 5;
const RATE_LIMIT_MAX_ATTEMPTS = 30;

function isValidDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Fecha del servicio debe caer en una ventana cercana razonable: hoy (Chile) hasta +7 días. */
function isReasonableServiceDate(fechaServicioIso, now) {
  const todayChile = chileWallClock(now).slice(0, 10);
  const [y, m, d] = todayChile.split('-').map(Number);
  const minDate = new Date(Date.UTC(y, m - 1, d));
  const maxDate = new Date(minDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [fy, fm, fd] = fechaServicioIso.split('-').map(Number);
  const target = new Date(Date.UTC(fy, fm - 1, fd));
  return target.getTime() >= minDate.getTime() && target.getTime() <= maxDate.getTime();
}

function isDuplicateValueError(error) {
  const detail = String((error && error.detail) || '').toLowerCase();
  return detail.includes('already has the value') || detail.includes('valor único') || detail.includes('unique');
}

module.exports = async function (context, req) {
  const body = req.body || {};
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const submissionId = typeof body.submissionId === 'string' ? body.submissionId.trim() : '';
  const fechaServicio = body.fechaServicio;
  const tipoSolicitud = body.tipoSolicitud === 'Reemplazo' ? 'Reemplazo' : 'Solicitud diaria';
  const motivoReemplazo = typeof body.motivoReemplazo === 'string' ? body.motivoReemplazo.slice(0, 500) : undefined;
  const solicitanteNombre = typeof body.solicitanteNombre === 'string' ? body.solicitanteNombre.slice(0, 255) : undefined;
  const solicitanteCorreo = typeof body.solicitanteCorreo === 'string' ? body.solicitanteCorreo.slice(0, 255) : undefined;
  const servicios = Array.isArray(body.servicios) ? body.servicios : [];

  // Honeypot: campo oculto que un usuario real nunca llena. Si llegó lleno, es un bot —
  // se responde OK genérico sin hacer nada, para no darle ninguna señal distinta.
  if (typeof body.sitioWeb === 'string' && body.sitioWeb.trim() !== '') {
    context.log.warn('Honeypot activado — probable bot.');
    sendJson(context, 200, GENERIC_OK);
    return;
  }

  if (!token || !submissionId || !isValidDateString(fechaServicio) || servicios.length === 0) {
    sendJson(context, 200, GENERIC_INVALID);
    return;
  }

  const now = new Date();
  if (!isReasonableServiceDate(fechaServicio, now)) {
    sendJson(context, 200, GENERIC_INVALID);
    return;
  }

  const tokenHash = hashToken(token);
  let channel;
  try {
    channel = await findChannelByTokenHash(tokenHash);
  } catch (error) {
    context.log.error('Error resolviendo canal', error);
    sendJson(context, 200, GENERIC_INVALID);
    return;
  }

  if (!channel) {
    // Token no reconocido: solo diagnóstico técnico, nunca una fila en SharePoint.
    context.log.warn('Intento de envío con token no reconocido.');
    sendJson(context, 200, GENERIC_INVALID);
    return;
  }

  const fields = channel.fields;
  const expired = Boolean(fields.FechaExpiracion) && new Date(fields.FechaExpiracion).getTime() < Date.now();
  if (fields.Estado !== 'Activo' || expired) {
    await logRejectedAttempt(channel.id, fields.Codigo, fields.Estado !== 'Activo' ? 'Canal inactivo' : 'Canal expirado');
    sendJson(context, 200, GENERIC_INVALID);
    return;
  }

  const attemptCount = await countRecentAttempts(channel.id, fields.Codigo, RATE_LIMIT_WINDOW_MINUTES);
  if (attemptCount >= RATE_LIMIT_MAX_ATTEMPTS) {
    await logRejectedAttempt(channel.id, fields.Codigo, 'Límite de intentos excedido');
    sendJson(context, 200, GENERIC_INVALID);
    return;
  }

  const activeServiceTypes = await getActiveContractServiceTypes(fields.ContratoId);
  const permitted = authorizedServices(fields.Modalidad, activeServiceTypes, fields.ExcepcionesServicios);

  const cleanServices = [];
  for (const item of servicios) {
    const tipoServicio = item && item.tipoServicio;
    const cantidad = Number(item && item.cantidad);
    if (!permitted.includes(tipoServicio)) {
      await logRejectedAttempt(channel.id, fields.Codigo, 'Servicio no autorizado');
      sendJson(context, 200, GENERIC_INVALID);
      return;
    }
    if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > MAX_CANTIDAD) {
      await logRejectedAttempt(channel.id, fields.Codigo, 'Validación de datos inválida');
      sendJson(context, 200, GENERIC_INVALID);
      return;
    }
    if (cantidad > 0) cleanServices.push({ tipoServicio, cantidad });
  }
  if (cleanServices.length === 0) {
    await logRejectedAttempt(channel.id, fields.Codigo, 'Validación de datos inválida');
    sendJson(context, 200, GENERIC_INVALID);
    return;
  }

  // Fuera de plazo NO es un rechazo: se guarda igual, pendiente de aceptación interna.
  const fueraDePlazo = !isWithinDeadline(fechaServicio, fields.HoraCierre, now);
  const estadoSolicitud = fueraDePlazo ? 'Extraordinaria pendiente' : 'Oficial';

  const contratoServicio = (await getContractServiceLabel(fields.ContratoId)) || '';
  const fechaRecepcionIso = now.toISOString();

  for (const { tipoServicio, cantidad } of cleanServices) {
    const claveFila = `${channel.id}|${submissionId}|${fechaServicio}|${tipoServicio}`;
    // Chequeo antes de escribir: evita una llamada innecesaria en el caso normal. La
    // garantía real contra duplicados es la columna ClaveFila con EnforceUniqueValues
    // en SharePoint — si dos envíos llegan casi juntos, SharePoint rechaza el segundo.
    const existing = await findByClaveFila(claveFila);
    if (existing) continue;

    try {
      await createServiceRequest({
        Title: claveFila,
        ClienteId: fields.ClienteId,
        ContratoId: fields.ContratoId,
        ContratoServicio: contratoServicio,
        FechaServicio: fechaServicio,
        TipoServicio: tipoServicio,
        CantidadOficial: cantidad,
        OrigenSolicitud: 'Cliente',
        EstadoSolicitud: estadoSolicitud,
        PrecioUnitario: 0,
        SolicitanteNombre: solicitanteNombre,
        SolicitanteCorreo: solicitanteCorreo,
        FechaRecepcion: fechaRecepcionIso,
        VersionSolicitud: 1,
        CanalIngreso: 'Formulario externo',
        CodigoCanal: fields.Codigo,
        TipoSolicitud: tipoSolicitud,
        MotivoReemplazo: tipoSolicitud === 'Reemplazo' ? motivoReemplazo : undefined,
        FueraDePlazo: fueraDePlazo,
        SubmissionId: submissionId,
        ClaveFila: claveFila
      });
    } catch (error) {
      if (isDuplicateValueError(error)) {
        // Dos envíos simultáneos con la misma clave: el segundo pierde la carrera contra
        // la columna única de SharePoint — se trata como éxito idempotente, no como error.
        continue;
      }
      context.log.error('Error creando solicitud', error);
      sendJson(context, 200, GENERIC_INVALID);
      return;
    }
  }

  sendJson(context, 200, fueraDePlazo
    ? { ok: true, message: 'Solicitud recibida fuera de plazo. Queda pendiente de aceptación interna.' }
    : GENERIC_OK);
};
