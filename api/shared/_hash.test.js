const assert = require('assert');
process.env.PORTAL_SESSION_SECRET = 'clave-de-prueba-no-real';
const { hashPin, verifyPin, signSession, verifySession } = require('./hash');

// PIN: mismo PIN + misma sal -> mismo hash; verifica correcto, rechaza incorrecto.
const salt = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
const hash = hashPin('4821', salt);
assert.strictEqual(hashPin('4821', salt), hash, 'mismo PIN y sal deben producir el mismo hash siempre');
assert.strictEqual(verifyPin('4821', salt, hash), true, 'PIN correcto debe verificar');
assert.strictEqual(verifyPin('4822', salt, hash), false, 'PIN incorrecto no debe verificar');
assert.strictEqual(verifyPin('4821', salt, 'no-es-un-hash-real'), false, 'hash corrupto/de otro largo no debe verificar');
assert.strictEqual(verifyPin('4821', undefined, undefined), false, 'sin sal/hash configurados nunca debe verificar');
console.log('Todas las pruebas de PIN pasaron.');

// Sesion: firma y verifica correctamente, detecta manipulacion y expiracion.
const session = signSession(7);
assert.strictEqual(verifySession(session), 7, 'una sesion recien firmada debe verificar con el mismo CanalId');
assert.strictEqual(verifySession(session + 'x'), null, 'una sesion manipulada nunca debe verificar');
assert.strictEqual(verifySession('cualquier-cosa'), null, 'un valor que no es una sesion real debe fallar sin lanzar error');
assert.strictEqual(verifySession(''), null, 'una sesion vacia debe fallar sin lanzar error');

// Sesion expirada: se firma "en el pasado" reconstruyendo el payload a mano con la misma firma.
const crypto = require('crypto');
const expiredPayload = Buffer.from(JSON.stringify({ cid: 7, exp: Date.now() - 1000 }), 'utf8').toString('base64url');
const expiredMac = crypto.createHmac('sha256', process.env.PORTAL_SESSION_SECRET).update(expiredPayload).digest('base64url');
assert.strictEqual(verifySession(`${expiredPayload}.${expiredMac}`), null, 'una sesion ya expirada nunca debe verificar aunque la firma sea valida');
console.log('Todas las pruebas de sesion pasaron.');
