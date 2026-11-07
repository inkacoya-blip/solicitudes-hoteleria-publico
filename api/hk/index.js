const { sendJson } = require('../shared/respond');
const { uploadFileToDrive } = require('../shared/graph');
const repo = require('../shared/hkRepository');
const { createHandlers, ACTIONS, GENERIC_ERROR } = require('../shared/hkHandlers');

/**
 * App del celular de hospedaje: una sola Function con ruta /api/hk/<acción>.
 * Toda la lógica está en shared/hkHandlers.js (se prueba con SharePoint simulado).
 * Siempre responde 200 con { ok, message }: el detalle técnico queda solo en los registros del servidor.
 */
module.exports = async function (context, req) {
  try {
    const action = context.bindingData && context.bindingData.action;
    const method = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    if (!method) {
      sendJson(context, 200, GENERIC_ERROR);
      return;
    }
    const handlers = createHandlers({
      repo,
      uploadFile: uploadFileToDrive,
      log: (error) => context.log.error('Error en /api/hk', error)
    });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    sendJson(context, 200, await handlers[method](body));
  } catch (error) {
    context.log.error('Error inesperado en /api/hk', error);
    sendJson(context, 200, GENERIC_ERROR);
  }
};
