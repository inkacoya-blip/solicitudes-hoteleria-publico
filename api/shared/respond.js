/**
 * `jsonBody` es del modelo de programación v4 (@azure/functions) — el runtime que
 * realmente usan las Functions administradas de Static Web Apps es el clásico
 * (function.json + context.res), donde el campo correcto es `body` + Content-Type
 * explícito. Usar jsonBody ahí no da error, simplemente el cuerpo queda vacío.
 */
function sendJson(context, status, payload) {
  context.res = {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

module.exports = { sendJson };
