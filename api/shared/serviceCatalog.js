/**
 * Espejo de RequestFormTemplate/EdpServiceType en el ERP (models.ts, requestFormTemplates.ts).
 * Define qué pregunta cada modalidad — los servicios AUTORIZADOS de verdad son la
 * intersección de esto con las tarifas vigentes del contrato (ver channel-resolve).
 */
const MODALITY_QUESTION_SET = {
  'Alimentación en instalación': [
    'Desayuno', 'Desayuno reforzado', 'Almuerzo', 'Almuerzo hipocalórico', 'Cena', 'Cena hipocalórica',
    'Colación', 'Colación desayuno', 'Colación desayuno reforzado', 'Colación almuerzo', 'Colación cena',
    'Colación cena hipocalórica', 'Colación sándwich', 'Colación hídrica', 'Colación reforzada', 'Bidón agua 20 litros'
  ],
  'Almuerzo a terreno': ['Almuerzo', 'Almuerzo hipocalórico'],
  'Cena a terreno': ['Cena', 'Cena hipocalórica'],
  // 'Colación a terreno' queda deliberadamente reservada — el ERP bloquea su creación.
  'Colación a terreno': []
};

function questionSetFor(modalidad) {
  return MODALITY_QUESTION_SET[modalidad] || [];
}

function safeParseStringArray(json) {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Servicios efectivos: intersección modalidad ∩ tarifas vigentes del contrato, más excepciones del canal. */
function authorizedServices(modalidad, activeContractServiceTypes, exceptionsJson) {
  const question = questionSetFor(modalidad);
  const fromRates = question.filter((service) => activeContractServiceTypes.includes(service));
  const exceptions = safeParseStringArray(exceptionsJson).filter((service) => question.includes(service));
  return Array.from(new Set([...fromRates, ...exceptions]));
}

const WEEK_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/** Mismo formato que ExcepcionesServicios: JSON de días en texto — mirror de parseDiasServicio en utils.ts del ERP. Vacío/sin definir = todos los días. */
function parseDiasServicio(json) {
  return safeParseStringArray(json).filter((day) => WEEK_DAYS.includes(day));
}

/** true si el contrato opera ese día — sin DiasServicio definido, opera todos los días (compatibilidad con contratos existentes). */
function operatesOnWeekday(diasServicioJson, fechaIso) {
  const dias = parseDiasServicio(diasServicioJson);
  if (dias.length === 0) return true;
  const [y, m, d] = fechaIso.split('-').map(Number);
  const weekdayIndex = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=domingo..6=sábado
  const byIndex = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return dias.includes(byIndex[weekdayIndex]);
}

module.exports = { questionSetFor, authorizedServices, parseDiasServicio, operatesOnWeekday };
