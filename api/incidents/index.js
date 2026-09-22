const { hashToken } = require('../shared/hash');
const { sendJson } = require('../shared/respond');
const {
  findIncidentChannelByTokenHash,
  getEstablishmentName,
  createIncidentReport,
  logRejectedAttempt,
  countRecentIncidentAttempts
} = require('../shared/repository');
const { uploadFileToDrive } = require('../shared/graph');

const GENERIC_INVALID = { ok: false, message: 'No fue posible registrar la incidencia.' };
const GENERIC_OK = { ok: true, message: 'Incidencia registrada.' };
const RATE_LIMIT_WINDOW_MINUTES = 5;
const RATE_LIMIT_MAX_ATTEMPTS = 30;
// Base64 crece ~33% sobre el binario — 6 MB de texto son ~4.5 MB reales, ya con margen
// sobre lo que deja una foto redimensionada/comprimida en el navegador antes de enviarla.
const MAX_FOTO_BASE64_LENGTH = 6 * 1024 * 1024;

const TIPOS = ['Mantenimiento', 'Calidad', 'Personal', 'Equipamiento', 'Infraestructura', 'Seguridad', 'Servicio', 'Otro'];
const PRIORIDADES = ['Crítica', 'Alta', 'Media', 'Baja'];

function isDuplicateValueError(error) {
  const detail = String((error && error.detail) || '').toLowerCase();
  return detail.includes('already has the value') || detail.includes('valor único') || detail.includes('unique');
}

function extensionFor(contentType) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
}

module.exports = async function (context, req) {
  try {
    const body = req.body || {};
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const submissionId = typeof body.submissionId === 'string' ? body.submissionId.trim() : '';
    const tipo = TIPOS.includes(body.tipo) ? body.tipo : '';
    const prioridad = PRIORIDADES.includes(body.prioridad) ? body.prioridad : '';
    const afectaContinuidad = Boolean(body.afectaContinuidad);
    const descripcion = typeof body.descripcion === 'string' ? body.descripcion.trim().slice(0, 2000) : '';
    const reportadoPor = typeof body.reportadoPor === 'string' ? body.reportadoPor.trim().slice(0, 255) : '';
    const fotoBase64 = typeof body.fotoBase64 === 'string' ? body.fotoBase64 : '';
    const fotoContentType = typeof body.fotoContentType === 'string' ? body.fotoContentType : 'image/jpeg';

    // Honeypot: mismo patrón que /api/requests — un bot que llena este campo recibe un OK genérico sin registrar nada.
    if (typeof body.sitioWeb === 'string' && body.sitioWeb.trim() !== '') {
      context.log.warn('Honeypot activado en incidents — probable bot.');
      sendJson(context, 200, GENERIC_OK);
      return;
    }

    if (!token || !submissionId || !tipo || !prioridad || !descripcion || !reportadoPor) {
      sendJson(context, 200, GENERIC_INVALID);
      return;
    }

    if (fotoBase64 && fotoBase64.length > MAX_FOTO_BASE64_LENGTH) {
      sendJson(context, 200, { ok: false, message: 'La foto es demasiado grande. Inténtalo de nuevo — se debería haber reducido sola.' });
      return;
    }

    const tokenHash = hashToken(token);
    const channel = await findIncidentChannelByTokenHash(tokenHash);

    if (!channel) {
      // Token no reconocido: solo diagnóstico técnico, nunca una fila en SharePoint.
      context.log.warn('Intento de envío de incidencia con token no reconocido.');
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

    const attemptCount = await countRecentIncidentAttempts(channel.id, fields.Codigo, RATE_LIMIT_WINDOW_MINUTES);
    if (attemptCount >= RATE_LIMIT_MAX_ATTEMPTS) {
      await logRejectedAttempt(channel.id, fields.Codigo, 'Límite de intentos excedido');
      sendJson(context, 200, GENERIC_INVALID);
      return;
    }

    let fotoUrl;
    if (fotoBase64) {
      const buffer = Buffer.from(fotoBase64, 'base64');
      const extension = extensionFor(fotoContentType);
      const path = `IncidenciasFotos/${encodeURIComponent(fields.Codigo)}/${Date.now()}-${submissionId}.${extension}`;
      fotoUrl = await uploadFileToDrive(path, buffer, fotoContentType);
    }

    const establecimientoNombre = await getEstablishmentName(fields.EstablecimientoId);

    try {
      await createIncidentReport({
        Title: `${fields.Codigo} · ${tipo}`,
        EstablecimientoId: fields.EstablecimientoId,
        Tipo: tipo,
        Descripcion: descripcion,
        ReportadoPor: reportadoPor,
        Prioridad: prioridad,
        AfectaContinuidad: afectaContinuidad,
        Estado: 'Reportado',
        FotoUrl: fotoUrl,
        CanalIngreso: 'Formulario externo',
        CodigoCanal: fields.Codigo,
        SubmissionId: submissionId
      });
    } catch (error) {
      if (!isDuplicateValueError(error)) throw error;
      // Reintento con el mismo SubmissionId (ej. doble tap en el celular): éxito idempotente, no error.
    }

    sendJson(context, 200, { ok: true, message: `Incidencia registrada en ${establecimientoNombre || 'el establecimiento'}. Gracias.` });
  } catch (error) {
    context.log.error('Error inesperado en /api/incidents', error);
    sendJson(context, 200, GENERIC_INVALID);
  }
};
