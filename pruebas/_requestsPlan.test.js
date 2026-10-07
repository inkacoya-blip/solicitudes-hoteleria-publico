const assert = require('assert');
const path = require('path');

// Repositorio simulado en memoria: el endpoint se prueba completo, sin red ni SharePoint.
const repoPath = require.resolve('../api/shared/repository');
const created = [];
const rejected = [];
let attempts = 0;
let failOnce = null;
const existing = [];
const channel = {
  id: '3',
  fields: { Codigo: 'ICH-CAN-0003', Estado: 'Activo', ClienteId: 7, ContratoId: 5, Modalidad: 'Alimentación en instalación', HoraCierre: '18:00' }
};
require.cache[repoPath] = {
  id: repoPath, filename: repoPath, loaded: true,
  exports: {
    findChannelByTokenHash: async (hash) => (hash === require('../api/shared/hash').hashToken('tok-ok') ? channel : undefined),
    getContract: async () => ({ fields: { ContratoServicio: 'Campamento norte', HorasAnticipacionSolicitudes: 24, DiasServicio: undefined } }),
    getContractServiceLabel: async () => 'Campamento norte',
    getActiveContractServiceTypes: async () => ['Desayuno', 'Almuerzo', 'Cena'],
    findByClaveFila: async (clave) => created.find((row) => row.ClaveFila === clave),
    listContractServiceRequests: async (_c, tipo) => existing.filter((item) => item.fields.TipoServicio === tipo),
    createServiceRequest: async (fields) => {
      if (failOnce && fields.TipoServicio === failOnce.tipo && !failOnce.used) { failOnce.used = true; throw new Error('Graph caído'); }
      created.push(fields);
      return { id: String(100 + created.length) };
    },
    logRejectedAttempt: async (_id, _code, motivo) => { rejected.push(motivo); },
    countRecentAttempts: async () => attempts
  }
};
const handler = require('../api/requests-plan/index');

const iso = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const D1 = iso(10);
const D2 = iso(11);
const call = async (body) => {
  const context = { log: Object.assign(() => {}, { warn() {}, error() {} }) };
  await handler(context, { body });
  return JSON.parse(context.res.body);
};
const base = {
  token: 'tok-ok', submissionId: 'sub-1', plantillaCodigo: 'ICH-CAN-0003',
  solicitanteNombre: 'Tamara', solicitanteCorreo: 'tamara@mantos.cl',
  dias: [
    { fecha: D1, servicios: [{ tipoServicio: 'Desayuno', cantidad: 4 }, { tipoServicio: 'Cena', cantidad: 0 }] },
    { fecha: D2, servicios: [{ tipoServicio: 'Almuerzo', cantidad: 6 }] }
  ]
};

(async () => {
  // Vista previa: valida y resume, NO escribe.
  const preview = await call({ ...base, confirmar: false });
  assert.strictEqual(preview.ok, true, JSON.stringify(preview));
  assert.deepStrictEqual(preview.resumen, { dias: 2, filas: 3, fueraDePlazo: 0, ceros: 1 });
  assert.strictEqual(created.length, 0);

  // Confirmar: escribe una fila por servicio/día, incluido el 0 explícito, con el contrato del canal (no el del navegador).
  const sent = await call({ ...base, confirmar: true });
  assert.strictEqual(sent.ok, true, JSON.stringify(sent));
  assert.strictEqual(created.length, 3);
  const cena = created.find((row) => row.TipoServicio === 'Cena');
  assert.strictEqual(cena.CantidadOficial, 0);
  assert.strictEqual(cena.ClienteId, 7);
  assert.strictEqual(cena.ContratoId, 5);
  assert.strictEqual(cena.EstadoSolicitud, 'Oficial');
  assert.strictEqual(cena.TipoSolicitud, 'Solicitud diaria');
  assert.strictEqual(cena.SolicitanteCorreo, 'tamara@mantos.cl');

  // Reintentar el MISMO envío no duplica nada.
  const again = await call({ ...base, confirmar: true });
  assert.strictEqual(again.ok, true);
  assert.strictEqual(created.length, 3);

  // Una versión nueva (otro envío) reemplaza lo anterior de ese día/servicio, sin sobrescribirlo.
  existing.push({ id: '555', fields: { TipoServicio: 'Desayuno', FechaServicio: D1, EstadoSolicitud: 'Oficial', HoraServicio: '', FechaRecepcion: '2026-01-01T00:00:00Z' } });
  const v2 = await call({ ...base, submissionId: 'sub-2', confirmar: true, dias: [{ fecha: D1, servicios: [{ tipoServicio: 'Desayuno', cantidad: 9 }] }] });
  assert.strictEqual(v2.ok, true);
  const nueva = created.find((row) => row.SubmissionId === 'sub-2');
  assert.strictEqual(nueva.TipoSolicitud, 'Reemplazo');
  assert.strictEqual(nueva.ReemplazaSolicitudId, '555');

  // Datos con errores: se informan todos, no se escribe nada.
  const antes = created.length;
  const mal = await call({ ...base, submissionId: 'sub-3', confirmar: true, dias: [{ fecha: D1, servicios: [{ tipoServicio: 'Hospedaje', cantidad: 2 }] }] });
  assert.strictEqual(mal.ok, false);
  assert.ok(/no está autorizado/.test(mal.errores[0]));
  assert.strictEqual(created.length, antes);

  // Plantilla de otro canal, token malo, honeypot, falta de identidad.
  assert.strictEqual((await call({ ...base, plantillaCodigo: 'ICH-CAN-0099', confirmar: true })).ok, false);
  assert.strictEqual((await call({ ...base, token: 'otro', confirmar: true })).ok, false);
  const bot = await call({ ...base, submissionId: 'sub-bot', sitioWeb: 'http://spam', confirmar: true });
  assert.strictEqual(bot.ok, true);
  assert.ok(!created.some((row) => row.SubmissionId === 'sub-bot'));
  const anonimo = await call({ ...base, submissionId: 'sub-4', solicitanteNombre: '', confirmar: true });
  assert.strictEqual(anonimo.ok, false);
  assert.ok(!created.some((row) => row.SubmissionId === 'sub-4'));

  // Límite de envíos: confirmar se frena, la vista previa no.
  attempts = 30;
  assert.strictEqual((await call({ ...base, submissionId: 'sub-5', confirmar: true })).ok, false);
  assert.strictEqual((await call({ ...base, confirmar: false })).ok, true);
  attempts = 0;

  // Fallo parcial: se avisa, y reenviar el mismo archivo completa solo lo que faltó.
  failOnce = { tipo: 'Almuerzo', used: false };
  const parcial = await call({ ...base, submissionId: 'sub-6', confirmar: true });
  assert.strictEqual(parcial.ok, false);
  assert.ok(/Se guardaron 2 de 3/.test(parcial.message), parcial.message);
  const reintento = await call({ ...base, submissionId: 'sub-6', confirmar: true });
  assert.strictEqual(reintento.ok, true);
  assert.strictEqual(created.filter((row) => row.SubmissionId === 'sub-6').length, 3);

  console.log('Todas las pruebas del endpoint de plan pasaron.');
})().catch((error) => { console.error(error); process.exit(1); });
