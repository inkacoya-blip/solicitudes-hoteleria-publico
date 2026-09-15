const crypto = require('crypto');

/** Mismo algoritmo que requestChannelService.ts en el ERP (SHA-256, hex, minúsculas) — deben coincidir siempre. */
function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Un PIN es de baja entropía (4-6 dígitos) — a diferencia del token, NUNCA se hashea con
 * SHA-256 simple (fuerza bruta offline trivial si el hash se filtra). Se usa PBKDF2-SHA256
 * con muchas iteraciones, igual que hace el ERP en el navegador con WebCrypto — mismo
 * algoritmo estándar (RFC 8018), mismos parámetros, mismo resultado en ambos lados.
 */
const PIN_PBKDF2_ITERATIONS = 210000;
const PIN_PBKDF2_KEYLEN = 32;

function hashPin(pin, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.pbkdf2Sync(pin, salt, PIN_PBKDF2_ITERATIONS, PIN_PBKDF2_KEYLEN, 'sha256').toString('hex');
}

/** Comparación en tiempo constante — nunca comparar hashes con === (permite medir por timing). */
function verifyPin(pin, saltHex, expectedHashHex) {
  if (!saltHex || !expectedHashHex) return false;
  const actual = Buffer.from(hashPin(pin, saltHex), 'hex');
  const expected = Buffer.from(expectedHashHex, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/**
 * Sesión temporal firmada (HMAC-SHA256), sin estado en SharePoint: el token embebe el
 * CanalId (no es secreto por sí solo — sin la firma, que solo el servidor puede producir,
 * no sirve para nada) y una expiración. El servidor SIEMPRE vuelve a resolver el canal por
 * ese CanalId antes de usarlo — el navegador nunca decide ClienteId/ContratoId, solo repite
 * este token opaco. Desactivar el canal invalida la sesión de inmediato porque el estado
 * Activo se revisa de nuevo en cada llamada.
 */
const SESSION_TTL_MS = 30 * 60 * 1000;

function getSessionSecret() {
  const secret = process.env.PORTAL_SESSION_SECRET;
  if (!secret) throw new Error('PORTAL_SESSION_SECRET no configurado.');
  return secret;
}

function signSession(canalId) {
  const payload = JSON.stringify({ cid: canalId, exp: Date.now() + SESSION_TTL_MS });
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', getSessionSecret()).update(payloadB64).digest('base64url');
  return `${payloadB64}.${mac}`;
}

/** Devuelve el CanalId si la sesión es válida y no expiró, o null si no. Nunca lanza. */
function verifySession(sessionToken) {
  try {
    if (typeof sessionToken !== 'string' || !sessionToken.includes('.')) return null;
    const [payloadB64, mac] = sessionToken.split('.');
    const expectedMac = crypto.createHmac('sha256', getSessionSecret()).update(payloadB64).digest('base64url');
    const macBuf = Buffer.from(mac);
    const expectedBuf = Buffer.from(expectedMac);
    if (macBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(macBuf, expectedBuf)) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload || typeof payload.cid !== 'number' || typeof payload.exp !== 'number') return null;
    if (Date.now() > payload.exp) return null;
    return payload.cid;
  } catch {
    return null;
  }
}

module.exports = {
  hashToken,
  hashPin,
  verifyPin,
  PIN_PBKDF2_ITERATIONS,
  PIN_PBKDF2_KEYLEN,
  signSession,
  verifySession
};
