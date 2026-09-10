const { hashToken } = require('../shared/hash');
const {
  findChannelByTokenHash,
  getClientName,
  getActiveContractServiceTypes,
  logRejectedAttempt
} = require('../shared/repository');
const { authorizedServices } = require('../shared/serviceCatalog');
const { sendJson } = require('../shared/respond');

// Siempre la misma forma de respuesta ante cualquier falla — nunca revela si el token
// alguna vez existió, ni por el mensaje ni distinguiendo el caso en el código HTTP.
// Todo el handler queda dentro de un try/catch: cualquier error no previsto debe
// devolver esta misma respuesta genérica, nunca un 500 crudo (eso sí sería una señal
// distinguible desde afuera).
const GENERIC_INVALID = { ok: false, message: 'Enlace no válido.' };

module.exports = async function (context, req) {
  try {
    const token = req.body && typeof req.body.token === 'string' ? req.body.token.trim() : '';
    if (!token) {
      sendJson(context, 200, GENERIC_INVALID);
      return;
    }

    const tokenHash = hashToken(token);
    const channel = await findChannelByTokenHash(tokenHash);

    if (!channel) {
      // Token que no coincide con ningún canal: SOLO diagnóstico técnico (este log),
      // nunca una fila en SharePoint — evita que adivinar tokens llene la lista.
      context.log.warn('Intento con token no reconocido.');
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

    const [clienteNombre, activeServiceTypes] = await Promise.all([
      getClientName(fields.ClienteId),
      getActiveContractServiceTypes(fields.ContratoId)
    ]);
    const servicios = authorizedServices(fields.Modalidad, activeServiceTypes, fields.ExcepcionesServicios);

    sendJson(context, 200, {
      ok: true,
      clienteNombre: clienteNombre || '',
      modalidad: fields.Modalidad,
      servicios,
      horaCierre: fields.HoraCierre || '18:00'
    });
  } catch (error) {
    context.log.error('Error inesperado en channel/resolve', error);
    // DIAGNÓSTICO TEMPORAL — revertir antes de dar el enlace a cualquier cliente real.
    sendJson(context, 200, { ...GENERIC_INVALID, debug: String((error && error.stack) || error) });
  }
};
