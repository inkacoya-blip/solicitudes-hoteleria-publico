/**
 * Cliente mínimo de Microsoft Graph, sin SDK — solo fetch/crypto nativos de Node 18+.
 * Menos dependencias = menos superficie de riesgo para algo que guarda un secreto de aplicación.
 * Autenticación app-only (client credentials) con el Entra ID App Registration que tiene
 * permiso Sites.Selected LIMITADO al sitio de Hotelería — nunca credenciales personales.
 */

let cachedToken; // { value, expiresAt } — vive mientras la instancia de la Function esté "tibia".

async function getAppOnlyToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.value;

  const tenantId = requireEnv('ENTRA_TENANT_ID');
  const clientId = requireEnv('ENTRA_CLIENT_ID');
  const clientSecret = requireEnv('ENTRA_CLIENT_SECRET');

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });

  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!response.ok) {
    throw new Error(`No fue posible autenticar contra Entra ID (${response.status}).`);
  }

  const data = await response.json();
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de configuración ${name}.`);
  return value;
}

async function graphFetch(path, init) {
  const token = await getAppOnlyToken();
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init && init.headers)
    }
  });
  return response;
}

let siteIdCache;
async function getSiteId() {
  if (siteIdCache) return siteIdCache;
  siteIdCache = requireEnv('SHAREPOINT_SITE_ID');
  return siteIdCache;
}

const listIdCache = {};
async function getListId(listDisplayName) {
  if (listIdCache[listDisplayName]) return listIdCache[listDisplayName];
  const siteId = await getSiteId();
  const response = await graphFetch(`/sites/${siteId}/lists?$filter=displayName eq '${listDisplayName}'&$select=id`, { method: 'GET' });
  if (!response.ok) throw new Error(`No fue posible resolver la lista ${listDisplayName} (${response.status}).`);
  const data = await response.json();
  const list = data.value && data.value[0];
  if (!list) throw new Error(`La lista ${listDisplayName} no existe en el sitio.`);
  listIdCache[listDisplayName] = list.id;
  return list.id;
}

async function getListItems(listDisplayName, oDataQuery) {
  const siteId = await getSiteId();
  const listId = await getListId(listDisplayName);
  const response = await graphFetch(`/sites/${siteId}/lists/${listId}/items?expand=fields${oDataQuery ? `&${oDataQuery}` : ''}`, { method: 'GET' });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Lectura de ${listDisplayName} falló (${response.status}): ${detail}`);
  }
  const data = await response.json();
  return (data.value || []).map((item) => ({ id: item.id, fields: item.fields }));
}

async function getListItemById(listDisplayName, itemId) {
  const siteId = await getSiteId();
  const listId = await getListId(listDisplayName);
  const response = await graphFetch(`/sites/${siteId}/lists/${listId}/items/${itemId}?expand=fields`, { method: 'GET' });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Lectura de ${listDisplayName}/${itemId} falló (${response.status}).`);
  const item = await response.json();
  return { id: item.id, fields: item.fields };
}

async function createListItem(listDisplayName, fields) {
  const siteId = await getSiteId();
  const listId = await getListId(listDisplayName);
  const response = await graphFetch(`/sites/${siteId}/lists/${listId}/items`, {
    method: 'POST',
    body: JSON.stringify({ fields })
  });
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`Creación en ${listDisplayName} falló (${response.status}): ${detail}`);
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  return response.json();
}

module.exports = { getSiteId, getListId, getListItems, getListItemById, createListItem };
