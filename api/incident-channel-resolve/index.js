const { hashToken } = require('../shared/hash');
const {
  findIncidentChannelByTokenHash,
  getEstablishmentName,
  logRejectedAttempt
} = require('../shared/repository');
const { sendJson } = require('../shared/respond');

// Misma disciplina que channel-resolve: siempre la misma respuesta genérica ante
// cualquier falla, nunca una señal que distinga "no existe" de "inactivo" desde afuera.
const GENERIC_INVALID = { ok: false, message: 'Enlace no válido.' };

module.exports = async function (context, req) {
  try {
    const token = req.body && typeof req.body.token === 'string' ? req.body.token.trim() : '';
    if (!token) {
      sendJson(context, 200, GENERIC_INVALID);
      return;
    }

    const tokenHash = hashToken(token);
    const channel = await findIncidentChannelByTokenHash(tokenHash);

    if (!channel) {
      // Token que no coincide con ningún canal: SOLO diagnóstico técnico, nunca una fila en SharePoint.
      context.log.warn('Intento con token de incidencias no reconocido.');
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

    const establecimientoNombre = await getEstablishmentName(fields.EstablecimientoId);

    sendJson(context, 200, {
      ok: true,
      establecimientoNombre: establecimientoNombre || ''
    });
  } catch (error) {
    context.log.error('Error inesperado en incident-channel/resolve', error);
    sendJson(context, 200, GENERIC_INVALID);
  }
};
