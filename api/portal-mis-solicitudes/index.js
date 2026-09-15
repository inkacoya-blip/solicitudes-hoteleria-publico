const { hashToken, verifySession } = require('../shared/hash');
const { chileWallClock } = require('../shared/time');
const { sendJson } = require('../shared/respond');
const { findChannelByTokenHash, listRecentServiceRequests } = require('../shared/repository');

const GENERIC_INVALID = { ok: false, message: 'Sesión inválida. Vuelve a ingresar.' };
const HISTORY_DAYS = 30;

function daysAgoIso(days, now) {
  const todayChile = chileWallClock(now).slice(0, 10);
  const [y, m, d] = todayChile.split('-').map(Number);
  const past = new Date(Date.UTC(y, m - 1, d) - days * 24 * 60 * 60 * 1000);
  return `${past.getUTCFullYear()}-${String(past.getUTCMonth() + 1).padStart(2, '0')}-${String(past.getUTCDate()).padStart(2, '0')}`;
}

/** 'Oficial'/'Extraordinaria pendiente'/'Arrastre automático'/'Anulada', mas 'reemplazada' cuando otra fila mas reciente la superó. */
function displayStatus(item, replacedIds) {
  if (replacedIds.has(item.id)) return 'reemplazada';
  const estado = item.fields.EstadoSolicitud;
  if (estado === 'Arrastre automático') return 'oficial-automatica';
  if (estado === 'Extraordinaria pendiente') return 'extraordinaria-pendiente';
  if (estado === 'Anulada') return 'no-aceptada';
  return 'oficial-cliente';
}

/**
 * "Mis solicitudes": se resuelve siempre desde el token, igual que /api/requests — nunca
 * confia en un ContratoId que mande el navegador. Si el canal tiene PIN configurado, ademas
 * exige una sesion valida para ESE mismo canal (ver shared/hash.js); si no tiene PIN, el
 * token alcanza, igual que antes de que existiera el PIN. Nunca devuelve tarifas, precios,
 * documentos ni datos de otros contratos.
 */
module.exports = async function (context, req) {
  try {
    const body = req.body || {};
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const sessionToken = typeof body.sessionToken === 'string' ? body.sessionToken.trim() : '';

    if (!token) {
      sendJson(context, 200, GENERIC_INVALID);
      return;
    }

    const tokenHash = hashToken(token);
    const channel = await findChannelByTokenHash(tokenHash);
    if (!channel) {
      sendJson(context, 200, GENERIC_INVALID);
      return;
    }

    const fields = channel.fields;
    const canalId = Number(channel.id);
    const expired = Boolean(fields.FechaExpiracion) && new Date(fields.FechaExpiracion).getTime() < Date.now();
    if (fields.Estado !== 'Activo' || expired) {
      sendJson(context, 200, GENERIC_INVALID);
      return;
    }

    if (fields.PinHash && fields.PinSalt) {
      const sessionCanalId = sessionToken ? verifySession(sessionToken) : null;
      if (sessionCanalId === null || sessionCanalId !== canalId) {
        sendJson(context, 200, GENERIC_INVALID);
        return;
      }
    }

    const since = daysAgoIso(HISTORY_DAYS, new Date());
    const recent = await listRecentServiceRequests(fields.ContratoId, since);

    const replacedIds = new Set();
    recent.forEach((item) => {
      if (item.fields.ReemplazaSolicitudId) replacedIds.add(Number(item.fields.ReemplazaSolicitudId));
    });

    const solicitudes = recent
      .map((item) => ({
        id: item.id,
        fecha: (item.fields.FechaServicio || '').slice(0, 10),
        tipoServicio: item.fields.TipoServicio,
        cantidad: item.fields.CantidadOficial,
        remitente: item.fields.SolicitanteNombre || '',
        horaEnvio: item.fields.FechaRecepcion || '',
        tipoSolicitud: item.fields.TipoSolicitud || 'Solicitud diaria',
        motivoReemplazo: item.fields.MotivoReemplazo || undefined,
        reemplazaSolicitudId: item.fields.ReemplazaSolicitudId || undefined,
        estado: displayStatus(item, replacedIds)
      }))
      .sort((a, b) => (b.fecha === a.fecha ? (b.horaEnvio || '').localeCompare(a.horaEnvio || '') : b.fecha.localeCompare(a.fecha)));

    sendJson(context, 200, { ok: true, solicitudes });
  } catch (error) {
    context.log.error('Error inesperado en /api/portal/mis-solicitudes', error);
    sendJson(context, 200, GENERIC_INVALID);
  }
};
