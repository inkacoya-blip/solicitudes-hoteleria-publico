const { chileTomorrow } = require('../shared/time');
const { authorizedServices } = require('../shared/serviceCatalog');
const { sendJson } = require('../shared/respond');
const {
  listActiveChannels,
  getContract,
  getActiveContractServiceTypes,
  hasOfficialRequestForDate,
  getLastOfficialQuantityBefore,
  createServiceRequest
} = require('../shared/repository');

/**
 * Disparado por un flujo de Power Automate con disparador Recurrencia (18:05, hora de
 * Chile) — NO por clientes. Protegido con un secreto compartido, no con el modelo de
 * token de canal (esto no representa a un cliente, actua sobre TODOS los contratos).
 *
 * Limitacion conocida: no existe en el ERP un campo de "dias sin servicio" por contrato
 * (ej. que no opere fines de semana), asi que este arrastre no distingue esos dias —
 * queda como algo a agregar si se necesita en el futuro.
 */

function isDuplicateValueError(error) {
  const detail = String((error && error.detail) || '').toLowerCase();
  return detail.includes('already has the value') || detail.includes('valor único') || detail.includes('unique');
}

module.exports = async function (context, req) {
  const secret = process.env.INTERNAL_ARRASTRE_SECRET;
  if (!secret || req.headers['x-internal-secret'] !== secret) {
    sendJson(context, 401, { ok: false, message: 'No autorizado.' });
    return;
  }

  try {
    const now = new Date();
    const manana = chileTomorrow(now);
    const channels = await listActiveChannels();

    const arrastrados = [];
    const alertas = [];

    for (const channel of channels) {
      const fields = channel.fields;
      let contract;
      try {
        contract = await getContract(fields.ContratoId);
      } catch (error) {
        context.log.error(`No se pudo leer el contrato ${fields.ContratoId}`, error);
        continue;
      }
      if (!contract || contract.fields.Estado !== 'Vigente') continue;
      if (contract.fields.ProyeccionAutomatica === false) continue;

      const activeServiceTypes = await getActiveContractServiceTypes(fields.ContratoId);
      const servicios = authorizedServices(fields.Modalidad, activeServiceTypes, fields.ExcepcionesServicios);

      for (const servicio of servicios) {
        const yaExiste = await hasOfficialRequestForDate(fields.ContratoId, servicio, manana);
        if (yaExiste) continue;

        const cantidad = await getLastOfficialQuantityBefore(fields.ContratoId, servicio, manana);
        if (cantidad === undefined) {
          // Nunca se inventa un cero: si no hay ningun dia anterior valido, se deja como
          // alerta para que el equipo lo resuelva a mano.
          alertas.push({
            contratoId: fields.ContratoId,
            contratoServicio: contract.fields.ContratoServicio,
            tipoServicio: servicio,
            motivo: 'Sin ningun dia anterior con solicitud oficial valida.'
          });
          continue;
        }

        const claveFila = `arrastre|${channel.id}|${manana}|${servicio}`;
        try {
          await createServiceRequest({
            Title: claveFila,
            ClienteId: fields.ClienteId,
            ContratoId: fields.ContratoId,
            ContratoServicio: contract.fields.ContratoServicio,
            FechaServicio: manana,
            TipoServicio: servicio,
            CantidadOficial: cantidad,
            OrigenSolicitud: 'Proyección automática',
            EstadoSolicitud: 'Arrastre automático',
            PrecioUnitario: 0,
            FechaRecepcion: now.toISOString(),
            VersionSolicitud: 1,
            CanalIngreso: 'Proyección automática',
            CodigoCanal: fields.Codigo,
            ClaveFila: claveFila
          });
          arrastrados.push({ contratoId: fields.ContratoId, tipoServicio: servicio, cantidad });
        } catch (error) {
          if (isDuplicateValueError(error)) continue; // ya se habia arrastrado (reintento del flujo)
          context.log.error(`Error creando arrastre para contrato ${fields.ContratoId}/${servicio}`, error);
          alertas.push({
            contratoId: fields.ContratoId,
            contratoServicio: contract.fields.ContratoServicio,
            tipoServicio: servicio,
            motivo: 'Error al crear el registro de arrastre — revisar manualmente.'
          });
        }
      }
    }

    sendJson(context, 200, { ok: true, fecha: manana, arrastrados, alertas });
  } catch (error) {
    context.log.error('Error inesperado en arrastre-diario', error);
    sendJson(context, 500, { ok: false, message: String((error && error.stack) || error) });
  }
};
