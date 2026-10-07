const { hashToken, verifySession } = require('../shared/hash');
const { authorizedServices } = require('../shared/serviceCatalog');
const { validatePlan } = require('../shared/planCore');
const { sendJson } = require('../shared/respond');
const {
  findChannelByTokenHash,
  getContract,
  getContractServiceLabel,
  getActiveContractServiceTypes,
  findByClaveFila,
  listContractServiceRequests,
  createServiceRequest,
  logRejectedAttempt,
  countRecentAttempts
} = require('../shared/repository');

const GENERIC_INVALID = { ok: false, message: 'No fue posible procesar la plantilla.' };
const RATE_LIMIT_WINDOW_MINUTES = 5;
const RATE_LIMIT_MAX_ATTEMPTS = 30;
const WRITE_CONCURRENCY = 4;
const CORREO_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isDuplicateValueError(error) {
  const detail = String((error && error.detail) || '').toLowerCase();
  return detail.includes('already has the value') || detail.includes('valor único') || detail.includes('unique');
}

/** Corre las tareas con pocas en paralelo: un plan trae decenas de filas y SharePoint no debe saturarse. */
async function runPool(tasks, size) {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker));
}

/**
 * Plan de varios días cargado desde la plantilla de Excel. El navegador lee el archivo y manda los números;
 * aquí se vuelve a validar TODO (el navegador nunca es la autoridad) y se escribe lo mismo que habrían
 * escrito N solicitudes diarias. Con `confirmar` falso solo devuelve el resumen, sin escribir nada.
 */
module.exports = async function (context, req) {
  try {
    const body = req.body || {};
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const submissionId = typeof body.submissionId === 'string' ? body.submissionId.trim() : '';
    const solicitanteNombre = typeof body.solicitanteNombre === 'string' ? body.solicitanteNombre.trim().slice(0, 255) : '';
    const solicitanteCorreo = typeof body.solicitanteCorreo === 'string' ? body.solicitanteCorreo.trim().slice(0, 255) : '';
    const confirmar = body.confirmar === true;

    // Honeypot: igual que en la solicitud diaria — un bot recibe una respuesta que no lo delata.
    if (typeof body.sitioWeb === 'string' && body.sitioWeb.trim() !== '') {
      context.log.warn('Honeypot activado en plan por plantilla — probable bot.');
      sendJson(context, 200, { ok: true, confirmado: false, message: 'Plan recibido.' });
      return;
    }

    if (!token || !submissionId || !Array.isArray(body.dias)) {
      sendJson(context, 200, GENERIC_INVALID);
      return;
    }
    if (confirmar && (!solicitanteNombre || !CORREO_PATTERN.test(solicitanteCorreo))) {
      sendJson(context, 200, { ok: false, message: 'Ingresa tu nombre y un correo válido.' });
      return;
    }

    const now = new Date();
    const channel = await findChannelByTokenHash(hashToken(token));
    if (!channel) {
      context.log.warn('Plan por plantilla con token no reconocido.');
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

    if (fields.PinHash && fields.PinSalt) {
      const sessionToken = typeof body.sessionToken === 'string' ? body.sessionToken.trim() : '';
      const sessionCanalId = sessionToken ? verifySession(sessionToken) : null;
      if (sessionCanalId === null || sessionCanalId !== Number(channel.id)) {
        await logRejectedAttempt(channel.id, fields.Codigo, 'Sesión inválida o expirada');
        sendJson(context, 200, { ok: false, message: 'Tu sesión expiró. Ingresa el PIN de nuevo.' });
        return;
      }
    }

    // La plantilla lleva el código de este canal: una plantilla de otro contrato no se aplica aquí.
    const plantillaCodigo = typeof body.plantillaCodigo === 'string' ? body.plantillaCodigo.trim() : '';
    if (plantillaCodigo !== fields.Codigo) {
      sendJson(context, 200, { ok: false, message: 'Esta plantilla no corresponde a este enlace. Descarga la plantilla desde esta misma página.' });
      return;
    }

    if (confirmar) {
      const attemptCount = await countRecentAttempts(channel.id, fields.Codigo, RATE_LIMIT_WINDOW_MINUTES);
      if (attemptCount >= RATE_LIMIT_MAX_ATTEMPTS) {
        await logRejectedAttempt(channel.id, fields.Codigo, 'Límite de intentos excedido');
        sendJson(context, 200, { ok: false, message: 'Demasiados envíos seguidos. Espera unos minutos e intenta de nuevo.' });
        return;
      }
    }

    const [contract, activeServiceTypes] = await Promise.all([
      getContract(fields.ContratoId),
      getActiveContractServiceTypes(fields.ContratoId)
    ]);
    const permitted = authorizedServices(fields.Modalidad, activeServiceTypes, fields.ExcepcionesServicios);
    const horasAnticipacion = contract && contract.fields.HorasAnticipacionSolicitudes;

    const plan = validatePlan({
      dias: body.dias,
      permitted,
      now,
      horaCierre: fields.HoraCierre,
      horasAnticipacion,
      diasServicio: contract && contract.fields.DiasServicio
    });

    if (!plan.ok) {
      sendJson(context, 200, { ok: false, message: 'La plantilla tiene datos que corregir.', errores: plan.errores });
      return;
    }

    if (!confirmar) {
      sendJson(context, 200, { ok: true, confirmado: false, resumen: plan.resumen, dias: plan.dias });
      return;
    }

    const contratoServicio = (contract && contract.fields.ContratoServicio) || (await getContractServiceLabel(fields.ContratoId)) || '';
    const fechaRecepcionIso = now.toISOString();

    // Reemplazos: una sola consulta por servicio, no una por fila.
    const existentesPorServicio = {};
    for (const tipoServicio of [...new Set(plan.filas.map((fila) => fila.tipoServicio))]) {
      existentesPorServicio[tipoServicio] = await listContractServiceRequests(fields.ContratoId, tipoServicio);
    }
    const anteriorDe = (fila) => (existentesPorServicio[fila.tipoServicio] || [])
      .filter((item) => (item.fields.FechaServicio || '').slice(0, 10) === fila.fecha
        && item.fields.EstadoSolicitud !== 'Anulada'
        && (item.fields.HoraServicio || '') === (fila.horario || ''))
      .sort((a, b) => (b.fields.FechaRecepcion || '').localeCompare(a.fields.FechaRecepcion || ''))[0];

    const failures = [];
    let escritas = 0;
    const tasks = plan.filas.map((fila) => async () => {
      const claveFila = `${channel.id}|${submissionId}|${fila.fecha}|${fila.tipoServicio}|${fila.horario || ''}`;
      try {
        // Reintento del mismo envío: lo que ya se escribió se salta (la columna única es la garantía real).
        if (await findByClaveFila(claveFila)) return;
        const previous = anteriorDe(fila);
        await createServiceRequest({
          Title: claveFila,
          ClienteId: fields.ClienteId,
          ContratoId: fields.ContratoId,
          ContratoServicio: contratoServicio,
          FechaServicio: fila.fecha,
          TipoServicio: fila.tipoServicio,
          HoraServicio: fila.horario,
          CantidadOficial: fila.cantidad,
          OrigenSolicitud: 'Cliente',
          EstadoSolicitud: fila.fueraDePlazo ? 'Extraordinaria pendiente' : 'Oficial',
          PrecioUnitario: 0,
          SolicitanteNombre: solicitanteNombre,
          SolicitanteCorreo: solicitanteCorreo,
          FechaRecepcion: fechaRecepcionIso,
          VersionSolicitud: 1,
          CanalIngreso: 'Formulario externo',
          CodigoCanal: fields.Codigo,
          TipoSolicitud: previous ? 'Reemplazo' : 'Solicitud diaria',
          MotivoReemplazo: previous ? 'Plan cargado desde la plantilla de Excel' : undefined,
          ReemplazaSolicitudId: previous ? previous.id : undefined,
          FueraDePlazo: fila.fueraDePlazo,
          SubmissionId: submissionId,
          ClaveFila: claveFila
        });
        escritas += 1;
      } catch (error) {
        if (isDuplicateValueError(error)) return; // carrera con un reintento: idempotente
        context.log.error(`Plan por plantilla: error escribiendo ${claveFila}`, error);
        failures.push(`${fila.fecha} · ${fila.tipoServicio}${fila.horario ? ` ${fila.horario}` : ''}`);
      }
    });
    await runPool(tasks, WRITE_CONCURRENCY);

    if (failures.length > 0) {
      // Nada se pierde ni se duplica: reenviar el MISMO archivo completa solo lo que faltó.
      sendJson(context, 200, {
        ok: false,
        message: `Se guardaron ${escritas} de ${plan.filas.length} líneas. Vuelve a enviar el mismo archivo para completar el resto: no se duplicará lo que ya llegó.`,
        errores: failures.slice(0, 10).map((item) => `No se pudo guardar: ${item}`)
      });
      return;
    }

    sendJson(context, 200, {
      ok: true,
      confirmado: true,
      resumen: plan.resumen,
      message: plan.resumen.fueraDePlazo > 0
        ? `Plan recibido: ${plan.resumen.dias} días. ${plan.resumen.fueraDePlazo} líneas quedan fuera de plazo, pendientes de aceptación interna.`
        : `Plan recibido: ${plan.resumen.dias} días registrados.`
    });
  } catch (error) {
    context.log.error('Error inesperado en /api/requests/plan', error);
    sendJson(context, 200, GENERIC_INVALID);
  }
};
