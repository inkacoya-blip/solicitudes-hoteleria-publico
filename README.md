# Solicitudes diarias — página pública

Reemplaza "un Microsoft Forms por cliente" por una sola página pública reutilizable.
El cliente recibe un enlace único (`https://<dominio>/#/c/<token>`); la página lee el
token del fragmento (`#`, nunca llega al servidor por URL ni queda en logs), lo borra
de la barra de direcciones de inmediato y lo manda en el **cuerpo** de la solicitud a
`/api`. La identidad (cliente, contrato, servicios autorizados) se resuelve siempre en
el servidor — esta página nunca decide ni envía `ClienteId`/`ContratoId`.

Repositorio separado a propósito del ERP (`erp-inka-coya-hoteleria`): esta página es
pública y sin autenticación, el ERP es interno y autenticado — no deben compartir
código ni confianza.

## Estructura

```
index.html, app.js, styles.css   — la página pública (HTML/CSS/JS plano, sin frameworks)
staticwebapp.config.json         — encabezados de seguridad (Referrer-Policy, etc.)
api/
  channel/resolve/               — POST /api/channel/resolve  (token → nombre cliente + servicios)
  requests/                      — POST /api/requests         (token + servicios → escribe en SharePoint)
  shared/                        — Graph API sin SDK (fetch nativo de Node), hash SHA-256, reglas de plazo/Chile
```

Sin dependencias npm para el código de negocio — solo `fetch`/`crypto` nativos de Node
18+, para minimizar superficie de ataque en algo que maneja un secreto de aplicación.

## Qué falta para desplegar (requiere permisos que no tengo)

1. **Entra ID App Registration**, con permiso de aplicación (no delegado)
   `Sites.Selected` de Microsoft Graph, consentido por un administrador.
2. **Autorizar esa app contra el sitio de Hotelería únicamente** (no todo el tenant) —
   se hace con una llamada a Graph `POST /sites/{site-id}/permissions` con el sitio
   exacto, o desde SharePoint admin center → Sitios → Permisos activos.
3. Un **Azure Static Web App** (plan gratuito) conectado a este repositorio, con estas
   variables de configuración de la app (nunca en el repo):
   - `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`
   - `SHAREPOINT_SITE_ID` (formato `hostname,collectionId,siteId` — se obtiene una vez
     con `GET https://graph.microsoft.com/v1.0/sites/inkacoya.sharepoint.com:/sites/InkaCoyaHoteleria`)
4. (Opcional pero recomendado) un dominio propio como `solicitudes.inkacoya.cl`
   apuntando al Static Web App — mientras tanto sirve el dominio `*.azurestaticapps.net`
   que Azure asigna solo.

Instrucciones exactas de dónde hacer clic para cada paso se las doy por separado
cuando lleguemos ahí — no se puede avanzar sin que Francisca las autorice.
