# Despliegue en la NUBE (sin VM) — Auris

Guía para dejar Auris **100 % en la nube, gestionado, sin máquina virtual**, ideal
para pruebas y para poder **encender/apagar a voluntad** sin dejar tu equipo prendido.

## Arquitectura

```
   [ Frontend ]  Netlify           (estático, gratis, SIEMPRE on)
        │ HTTPS
        ▼
   [ Controlador ]  Render          (Node, free → se duerme inactivo)
        │ HTTPS (LOGICA_SECURE=true)
        ▼
   [ Lógica ]  Render               (Node, free → se duerme inactivo)
        ├──► SQL Server   = Azure SQL serverless   (auto-pausa)
        └──► MongoDB       = MongoDB Atlas M0       (gratis, siempre on)

  (el frontend también llama a la Lógica directo para la MULTIMEDIA)
```

| Pieza | Servicio | Plan de prueba | Cómo se "apaga" |
|---|---|---|---|
| Frontend | **Netlify** | Gratis | No se apaga (estático, sin costo) |
| Controlador + Lógica | **Render** | Free | **Scale-to-zero**: se duerme tras ~15 min inactivo, despierta con la 1ª petición (~30–60 s) |
| MongoDB | **MongoDB Atlas** | M0 gratis | No se apaga (sin costo) |
| SQL Server | **Azure SQL** | Serverless | **Auto-pausa** tras inactividad; despierta al conectarse |

> **Encender/apagar a voluntad:** en Render puedes **Suspend/Resume** cada servicio desde el dashboard; Atlas siempre está on (gratis); Azure SQL serverless se pausa solo. Así no pagas cómputo en reposo.

---

## 0. Cuentas necesarias (todas con tier gratuito)
- [Render](https://render.com) · [MongoDB Atlas](https://www.mongodb.com/atlas) · [Azure](https://azure.microsoft.com) (para Azure SQL) · [Netlify](https://www.netlify.com).
- El código ya está en GitHub (rama **`main`**) en los 3 repos `App-Kine/app_kinesiologia_*`.

**Orden de despliegue:** primero las **bases de datos** (1, 2), luego la **lógica** (3), el **controlador** (4) y por último el **frontend** (5).

---

## 1. MongoDB → Atlas (multimedia)
1. Crea un cluster **M0 (free)**.
2. **Database Access:** crea un usuario/clave. **Network Access:** permite `0.0.0.0/0` (para pruebas).
3. Copia el **connection string** (`mongodb+srv://usuario:clave@cluster.xxxx.mongodb.net`). Será tu `MONGO_URI`.
4. Inicializa los buckets:
   ```bash
   mongosh "mongodb+srv://usuario:clave@cluster.xxxx.mongodb.net/auris_media" database/mongodb/init_mongo.js
   ```

## 2. SQL Server → Azure SQL serverless
1. Crea un **Azure SQL Database** → modelo de cómputo **Serverless**, con **auto-pause** activado (p. ej. 1 hora).
2. En **Networking**, permite tu IP (o "Allow Azure services") para poder cargar el esquema.
3. Carga la BD con **Azure Data Studio** (o sqlcmd) ejecutando `database/AurisDB_INSTALL.sql`.
4. Anota: **server** (`xxx.database.windows.net`), **usuario**, **clave**, **DB** (`AurisDB`). Son `DB_HOST/DB_USER/DB_PASS/DB_NAME` (puerto 1433).

> El driver `mssql` ya usa `encrypt: true` → compatible con Azure SQL sin cambios.

## 3. Lógica → Render
1. **New → Blueprint** y elige el repo `app_kinesiologia_logica` (o **New → Web Service** manual).
   - Build: `npm install` · Start: `npm run start:cloud` · Branch: `main`.
   - El repo ya trae [`render.yaml`](render.yaml) con las variables; complétalas en el dashboard:
     `DB_*`, `MONGO_URI`/`MONGO_DB`, `JWT_SECRET`, `CORS_ORIGINS` (la URL de Netlify del paso 5),
     `FRONTEND_BASE_URL` (misma URL de Netlify), `NODE_ENV=production`.
2. Deploy. Anota la URL pública: `https://auris-logica.onrender.com`.
3. Verifica: abrir `https://auris-logica.onrender.com/readyz` → debe responder OK (SQL + Mongo accesibles).

## 4. Controlador → Render
1. **Blueprint** del repo `app_kinesiologia_controlador` (trae su [`render.yaml`](../app_kinesiologia_controlador/render.yaml)).
2. Variables:
   - `LOGICA_HOST` = `auris-logica.onrender.com` (host **sin** `https://` ni `/`).
   - `LOGICA_PORT` = `443` · `LOGICA_SECURE` = `true`.
   - `JWT_SECRET` = **el MISMO** valor que pusiste en la lógica.
   - `CORS_ORIGINS` = la URL de Netlify (paso 5).
   - `TRUST_PROXY` = `1` · `NODE_ENV=production`.
3. Deploy. Anota la URL: `https://auris-controlador.onrender.com`.

## 5. Frontend → Netlify
1. Edita `frontend/src/environments/environment.prod.ts` con las URLs reales:
   ```ts
   BASE_API_URL:  'https://auris-controlador.onrender.com/controlador_base/',
   LOGICA_API_URL:'https://auris-logica.onrender.com/base_logica/',
   ```
   Commitea ese cambio (Netlify compila desde el repo).
2. En Netlify: **Add new site → Import from GitHub** → repo `app_kinesiologia_frontend`, branch `main`.
   - El repo ya trae [`netlify.toml`](../app_kinesiologia_frontend/netlify.toml) (build `ng build --configuration production`, publish `www`, Node 20, y el redirect SPA).
3. Deploy. Tu app queda en `https://<algo>.netlify.app`.
4. **Vuelve al paso 3 y 4** y pon esa URL exacta en `CORS_ORIGINS` (lógica y controlador) y en `FRONTEND_BASE_URL` (lógica). Re-deploy de los backends.

---

## Variables de entorno (resumen)

**Lógica** (Render): `NODE_ENV=production`, `DB_HOST/DB_PORT/DB_USER/DB_PASS/DB_NAME`, `MONGO_URI/MONGO_DB`, `JWT_SECRET`, `CORS_ORIGINS`, `FRONTEND_BASE_URL`, y SMTP_* si envías correos (`MAIL_MODE=smtp`). Ver [`.env.example`](.env.example).

**Controlador** (Render): `NODE_ENV=production`, `LOGICA_HOST`, `LOGICA_PORT=443`, `LOGICA_SECURE=true`, `JWT_SECRET` (igual), `CORS_ORIGINS`, `TRUST_PROXY=1`. Ver [`.env.example`](../app_kinesiologia_controlador/.env.example).

**Frontend** (Netlify): no usa variables; las URLs van en `environment.prod.ts`.

---

## Encender / apagar (control de costo)
- **Render:** dashboard de cada servicio → **Suspend** (apaga) / **Resume** (enciende). En free, además se duermen solos por inactividad.
- **Azure SQL serverless:** se **pausa solo** tras la inactividad configurada; despierta al primer query (unos segundos).
- **Atlas M0** y **Netlify:** gratis y siempre disponibles (no hace falta apagarlos).

> Con esto, en reposo **no pagas cómputo**; solo el almacenamiento (centavos).

---

## Cosas a tener en cuenta (troubleshooting)
| Síntoma | Causa / solución |
|---|---|
| El frontend carga pero la API falla (CORS) | `CORS_ORIGINS` debe ser **exactamente** la URL de Netlify (con `https://`, sin `/` final), en **lógica y controlador**. Re-deploy tras cambiarla. |
| `No autorizado` en todo | `JWT_SECRET` distinto entre lógica y controlador. Deben ser idénticos. |
| El controlador no alcanza la lógica | `LOGICA_HOST` sin `https://`, `LOGICA_PORT=443`, `LOGICA_SECURE=true`. |
| Primera petición lenta (~30–60 s) | *Cold start* de Render free (el servicio estaba dormido). Normal. |
| `/readyz` da 503 | SQL o Mongo no accesibles: revisa `DB_*` / `MONGO_URI` y el firewall de Azure SQL / Network Access de Atlas. |
| Recargar `/login` da 404 | Falta el redirect SPA → ya está en `netlify.toml` (`/* → /index.html 200`). |
| Multimedia (audios/imágenes) no carga | El frontend pega a la **lógica** directo: su `CORS_ORIGINS` debe incluir la URL del frontend, y `LOGICA_API_URL` apuntar a la lógica pública. |

> **Nota de transporte:** el controlador llama a la lógica por HTTPS gracias al flag `LOGICA_SECURE` (invoker HTTP/HTTPS). En una red interna privada puedes dejar `LOGICA_SECURE=false` y HTTP.
