const { hashToken, verifyPin, signSession } = require('../shared/hash');
const { sendJson } = require('../shared/respond');
const {
  findChannelByTokenHash,
  getClientName,
  updateChannelPinState,
  logRejectedAttempt
} = require('../shared/repository');

const GENERIC_INVALID = { ok: false, message: 'Enlace no válido.' };
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Verifica el PIN de un canal que ya tiene uno configurado y, si es correcto, entrega una
 * sesion temporal firmada (ver shared/hash.js) para no volver a pedirlo en cada accion.
 * Si el canal no tiene PIN configurado, cualquier PIN se acepta y se entrega sesion igual
 * (el token ya es suficiente en ese caso) — mantiene compatibilidad con enlaces sin PIN.
 */
module.exports = async function (context, req) {
  try {
    const body = req.body || {};
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const pin = typeof body.pin === 'string' ? body.pin.trim() : '';

    if (!token) {
      sendJson(context, 200, GENERIC_INVALID);
      return;
    }

    const tokenHash = hashToken(token);
    const channel = await findChannelByTokenHash(tokenHash);
    if (!channel) {
      context.log.warn('Intento de PIN con token no reconocido.');
      sendJson(context, 200, GENERIC_INVALID);
      return;
    }

    const fields = channel.fields;
    const canalId = Number(channel.id);
    const expired = Boolean(fields.FechaExpiracion) && new Date(fields.FechaExpiracion).getTime() < Date.now();
    if (fields.Estado !== 'Activo' || expired) {
      await logRejectedAttempt(canalId, fields.Codigo, fields.Estado !== 'Activo' ? 'Canal inactivo' : 'Canal expirado');
      sendJson(context, 200, GENERIC_INVALID);
      return;
    }

    // Sin PIN configurado: el token alcanza, se entrega sesion sin comparar nada.
    if (!fields.PinHash || !fields.PinSalt) {
      const clienteNombre = await getClientName(fields.ClienteId);
      sendJson(context, 200, { ok: true, sessionToken: signSession(canalId), clienteNombre: clienteNombre || '' });
      return;
    }

    const bloqueadoHasta = fields.PinBloqueadoHasta ? new Date(fields.PinBloqueadoHasta).getTime() : 0;
    if (bloqueadoHasta > Date.now()) {
      const minutosRestantes = Math.ceil((bloqueadoHasta - Date.now()) / 60000);
      sendJson(context, 200, { ok: false, message: `Demasiados intentos. Intenta de nuevo en ${minutosRestantes} minuto${minutosRestantes === 1 ? '' : 's'}.` });
      return;
    }

    if (!pin || !verifyPin(pin, fields.PinSalt, fields.PinHash)) {
      const intentos = Number(fields.PinIntentosFallidos || 0) + 1;
      if (intentos >= MAX_PIN_ATTEMPTS) {
        await updateChannelPinState(canalId, { PinIntentosFallidos: 0, PinBloqueadoHasta: new Date(Date.now() + LOCKOUT_MS).toISOString() });
        await logRejectedAttempt(canalId, fields.Codigo, 'Bloqueado por intentos de PIN');
        sendJson(context, 200, { ok: false, message: `Demasiados intentos. Intenta de nuevo en ${Math.ceil(LOCKOUT_MS / 60000)} minutos.` });
        return;
      }
      await updateChannelPinState(canalId, { PinIntentosFallidos: intentos });
      await logRejectedAttempt(canalId, fields.Codigo, 'PIN incorrecto');
      sendJson(context, 200, { ok: false, message: 'PIN incorrecto.' });
      return;
    }

    await updateChannelPinState(canalId, { PinIntentosFallidos: 0, PinBloqueadoHasta: null });
    const clienteNombre = await getClientName(fields.ClienteId);
    sendJson(context, 200, { ok: true, sessionToken: signSession(canalId), clienteNombre: clienteNombre || '' });
  } catch (error) {
    context.log.error('Error inesperado en /api/portal/verify-pin', error);
    sendJson(context, 200, GENERIC_INVALID);
  }
};
