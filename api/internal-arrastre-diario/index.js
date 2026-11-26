const { chileTomorrow } = require('../shared/time');
const { authorizedServices, operatesOnWeekday, isColacion } = require('../shared/serviceCatalog');
const { sendJson } = require('../shared/respond');
const { fixedOrderLinesFor, contractTakesFixedOrder } = require('../shared/fixedOrder');
const { horarioFormFor, horarioFormServices } = require('../shared/horarioForm');
const {
  listActiveChannels,
  listContractsWithFixedOrder,
  getActiveRatePrices,
  getContract,
  getActiveContractServiceTypes,
  hasOfficialRequestForDate,
  hasOfficialRequestForDateAndHorario,
  getLastOfficialQuantityBefore,
  getLastOfficialColacionBlocksBefore,
  createServiceRequest
} = require('../shared/repository');

/**
 * Disparado por un flujo de Power Automate con disparador Recurrencia (18:05, hora de
 * Chile) — NO por clientes. Protegido con un secreto compartido, no con el modelo de
 * token de canal (esto no representa a un cliente, actua sobre TODOS los contratos).
 *
 * Respeta IContract.DiasServicio (JSON de dias de la semana) — si el contrato no opera
 * el dia de manana, no arrastra nada para el. Sin ese campo definido, opera todos los
 * dias (compatibilidad con contratos existentes que nunca lo configuraron).
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
    const pedidosFijos = [];

    // 1) Pedido fijo (ej. Lavandería): queda registrado como solicitud OFICIAL del día siguiente,
    //    sin confirmación. Va antes de las sugerencias: así esos servicios nunca quedan como «sugeridos».
    const fixedContracts = await listContractsWithFixedOrder();
    for (const contract of fixedContracts) {
      const cf = contract.fields;
      if (!contractTakesFixedOrder(cf, manana)) continue;
      const contratoId = Number(contract.id);
      const prices = await getActiveRatePrices(contratoId);
      for (const line of fixedOrderLinesFor(cf.PedidoFijo, manana)) {
        const hora = isColacion(line.TipoServicio) ? line.Hora : undefined;
        const yaExiste = hora
          ? await hasOfficialRequestForDateAndHorario(contratoId, line.TipoServicio, hora, manana)
          : await hasOfficialRequestForDate(contratoId, line.TipoServicio, manana);
        if (yaExiste) continue;
        const claveFila = `pedidofijo|${contratoId}|${manana}|${line.TipoServicio}|${hora || ''}`;
        try {
          await createServiceRequest({
            Title: claveFila,
            ClienteId: cf.ClienteId,
            ContratoId: contratoId,
            ContratoServicio: cf.ContratoServicio,
            FechaServicio: manana,
            TipoServicio: line.TipoServicio,
            HoraServicio: hora,
            CantidadOficial: line.Cantidad,
            OrigenSolicitud: 'Proyección automática',
            EstadoSolicitud: 'Oficial',
            PrecioUnitario: prices[line.TipoServicio] || 0,
            FechaRecepcion: now.toISOString(),
            VersionSolicitud: 1,
            CanalIngreso: 'Proyección automática',
            ConfirmadaPor: 'Pedido fijo del contrato',
            ConfirmadaEn: now.toISOString(),
            Observacion: 'Pedido fijo',
            ClaveFila: claveFila
          });
          pedidosFijos.push({ contratoId, tipoServicio: line.TipoServicio, cantidad: line.Cantidad });
        } catch (error) {
          if (isDuplicateValueError(error)) continue;
          context.log.error(`Error creando pedido fijo para contrato ${contratoId}/${line.TipoServicio}`, error);
          alertas.push({ contratoId, contratoServicio: cf.ContratoServicio, tipoServicio: line.TipoServicio, motivo: 'Error al registrar el pedido fijo — revisar manualmente.' });
        }
      }
    }

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
      // Sin DiasServicio definido, opera todos los días (compatibilidad con contratos existentes).
      if (!operatesOnWeekday(contract.fields.DiasServicio, manana)) continue;

      const activeServiceTypes = await getActiveContractServiceTypes(fields.ContratoId);
      const permitidos = authorizedServices(fields.Modalidad, activeServiceTypes, fields.ExcepcionesServicios);
      // Formulario por horario (ej. Mecamin desde 01-12): solo sus servicios, y TODOS se sugieren por bloque horario.
      const porHorario = horarioFormFor(contract.fields.FormularioPorHorario, manana);
      const servicios = porHorario ? horarioFormServices(porHorario, permitidos) : permitidos;

      for (const servicio of servicios) {
        // Colación se arrastra por bloque horario — el resto de los servicios sigue igual
        // que siempre (un solo bloque por día), salvo en contratos con formulario por horario.
        if (isColacion(servicio) || porHorario) {
          const priorBlocks = await getLastOfficialColacionBlocksBefore(fields.ContratoId, servicio, manana, contract.fields.SugerenciasDesde);
          if (priorBlocks.length === 0) {
            alertas.push({
              contratoId: fields.ContratoId,
              contratoServicio: contract.fields.ContratoServicio,
              tipoServicio: servicio,
              motivo: 'Sin ningun dia anterior con solicitud oficial valida.'
            });
            continue;
          }

          for (const block of priorBlocks) {
            const horario = block.fields.HoraServicio || undefined;
            const yaExisteBloque = await hasOfficialRequestForDateAndHorario(fields.ContratoId, servicio, horario, manana);
            if (yaExisteBloque) continue;

            const claveFila = `arrastre|${channel.id}|${manana}|${servicio}|${horario || ''}`;
            try {
              await createServiceRequest({
                Title: claveFila,
                ClienteId: fields.ClienteId,
                ContratoId: fields.ContratoId,
                ContratoServicio: contract.fields.ContratoServicio,
                FechaServicio: manana,
                TipoServicio: servicio,
                HoraServicio: horario,
                CantidadOficial: block.fields.CantidadOficial,
                OrigenSolicitud: 'Proyección automática',
                EstadoSolicitud: 'Arrastre automático',
                PrecioUnitario: 0,
                FechaRecepcion: now.toISOString(),
                VersionSolicitud: 1,
                CanalIngreso: 'Proyección automática',
                CodigoCanal: fields.Codigo,
                ClaveFila: claveFila
              });
              arrastrados.push({ contratoId: fields.ContratoId, tipoServicio: servicio, horario, cantidad: block.fields.CantidadOficial });
            } catch (error) {
              if (isDuplicateValueError(error)) continue; // ya se habia arrastrado (reintento del flujo)
              context.log.error(`Error creando arrastre para contrato ${fields.ContratoId}/${servicio}/${horario}`, error);
              alertas.push({
                contratoId: fields.ContratoId,
                contratoServicio: contract.fields.ContratoServicio,
                tipoServicio: servicio,
                motivo: `Error al crear el bloque ${horario || 'sin horario'} — revisar manualmente.`
              });
            }
          }
          continue;
        }

        const yaExiste = await hasOfficialRequestForDate(fields.ContratoId, servicio, manana);
        if (yaExiste) continue;

        const cantidad = await getLastOfficialQuantityBefore(fields.ContratoId, servicio, manana, contract.fields.SugerenciasDesde);
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

    sendJson(context, 200, { ok: true, fecha: manana, pedidosFijos, arrastrados, alertas });
  } catch (error) {
    context.log.error('Error inesperado en arrastre-diario', error);
    sendJson(context, 500, { ok: false, message: String((error && error.stack) || error) });
  }
};
