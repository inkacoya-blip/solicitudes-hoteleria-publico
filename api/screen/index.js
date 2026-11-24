const { hashToken } = require('../shared/hash');
const { getListItems } = require('../shared/graph');
const { sendJson } = require('../shared/respond');
const { chileWallClock } = require('../shared/time');
const { screenDate, buildScreen } = require('../shared/screenCore');

/**
 * Pantalla de producción (tele del casino): solo lectura. El enlace lleva un token cuyo
 * hash se guarda en ICH_PANTALLAS_PRODUCCION (lo genera el ERP en Solicitudes › Panel).
 * Ante cualquier falla responde siempre lo mismo, sin revelar si el token existió.
 */
const GENERIC_INVALID = { ok: false, message: 'Enlace no válido. Pide uno nuevo en el ERP (Solicitudes › Panel › Enlace para pantalla).' };

function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

module.exports = async function (context, req) {
  try {
    const token = req.body && typeof req.body.token === 'string' ? req.body.token.trim() : '';
    if (!/^[0-9a-f]{64}$/.test(token)) {
      sendJson(context, 200, GENERIC_INVALID);
      return;
    }
    const screens = await getListItems('ICH_PANTALLAS_PRODUCCION', `filter=fields/TokenHash eq '${hashToken(token)}'&top=1`);
    if (!screens[0] || screens[0].fields.Estado !== 'Activo') {
      context.log.warn('Pantalla: token no reconocido o inactivo.');
      sendJson(context, 200, GENERIC_INVALID);
      return;
    }

    const now = new Date();
    const date = screenDate(now);
    const [requests, contracts, clients, rates] = await Promise.all([
      getListItems('ICH_SOLICITUDES_SERVICIO', `filter=fields/FechaServicio ge '${date}T00:00:00Z' and fields/FechaServicio lt '${addDays(date, 1)}T00:00:00Z'&top=999`),
      getListItems('ICH_CONTRATOS', 'top=999'),
      getListItems('ICH_CLIENTES', 'top=999'),
      getListItems('ICH_CONTRATOS_TARIFAS', 'top=999')
    ]);
    const screen = buildScreen({ date, requests, contracts, clients, rates });
    sendJson(context, 200, { ok: true, actualizado: chileWallClock(now), ...screen });
  } catch (error) {
    context.log.error('Error inesperado en /api/screen', error);
    sendJson(context, 200, { ok: false, message: 'No se pudo cargar la información. Se reintentará en un momento.' });
  }
};
