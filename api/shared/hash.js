const crypto = require('crypto');

/** Mismo algoritmo que requestChannelService.ts en el ERP (SHA-256, hex, minúsculas) — deben coincidir siempre. */
function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

module.exports = { hashToken };
