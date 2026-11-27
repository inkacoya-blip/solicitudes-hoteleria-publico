const assert = require('assert');
const { displayStatus, computeReplacedIds, supersededSuggestionIds } = require('./requestStatus');

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

// Mecamin 27-11: Tamara envió su solicitud; las sugerencias de ese día no se le muestran.
const dia = (id, extra) => ({ id: String(id), fields: { ClienteId: 2, ContratoId: 2, FechaServicio: '2026-11-27T03:00:00Z', ...extra } });
const ocultas = supersededSuggestionIds([
  dia(1544, { EstadoSolicitud: 'Oficial', OrigenSolicitud: 'Cliente', TipoServicio: 'Desayuno' }),
  dia(1551, { EstadoSolicitud: 'Arrastre automático', OrigenSolicitud: 'Proyección automática', TipoServicio: 'Cena hipocalórica' }),
  { id: '1600', fields: { ClienteId: 2, ContratoId: 2, FechaServicio: '2026-11-28T03:00:00Z', EstadoSolicitud: 'Arrastre automático', OrigenSolicitud: 'Proyección automática' } }
]);
assert.ok(ocultas.has(1551), 'sugerencia de un día con solicitud del cliente: oculta');
assert.ok(!ocultas.has(1600), 'sugerencia de un día sin solicitud del cliente: se sigue mostrando');
assert.ok(!supersededSuggestionIds([dia(1, { EstadoSolicitud: 'Arrastre automático' }), dia(2, { EstadoSolicitud: 'Oficial', OrigenSolicitud: 'Proyección automática' })]).has(1), 'una sugerencia confirmada por el supervisor no cuenta como solicitud del cliente');

console.log('Todas las pruebas de estado de solicitudes pasaron.');
