const assert = require('assert');
const { displayStatus, computeReplacedIds } = require('./requestStatus');

// Regresion real: Graph devuelve item.id como STRING ("8"), pero ReemplazaSolicitudId se
// guarda como Number en SharePoint (8) — sin convertir, Set.has() nunca coincide y una
// solicitud reemplazada seguía mostrándose como vigente. Se encontró probando en el navegador.
const original = { id: '8', fields: { EstadoSolicitud: 'Oficial' } };
const reemplazo = { id: '9', fields: { EstadoSolicitud: 'Oficial', ReemplazaSolicitudId: 8 } };
const replacedIds = computeReplacedIds([original, reemplazo]);

assert.strictEqual(displayStatus(original, replacedIds), 'reemplazada', 'la solicitud original debe mostrarse como reemplazada');
assert.strictEqual(displayStatus(reemplazo, replacedIds), 'oficial-cliente', 'la solicitud que reemplaza sigue siendo la vigente');

assert.strictEqual(displayStatus({ id: '1', fields: { EstadoSolicitud: 'Arrastre automático' } }, new Set()), 'oficial-automatica');
assert.strictEqual(displayStatus({ id: '2', fields: { EstadoSolicitud: 'Extraordinaria pendiente' } }, new Set()), 'extraordinaria-pendiente');
assert.strictEqual(displayStatus({ id: '3', fields: { EstadoSolicitud: 'Anulada' } }, new Set()), 'no-aceptada');
assert.strictEqual(displayStatus({ id: '4', fields: { EstadoSolicitud: 'Oficial' } }, new Set()), 'oficial-cliente');

console.log('Todas las pruebas de estado de solicitudes pasaron.');
