# Auris · Capa Lógica

Backend con la lógica de negocio del MVP de **Auris** — plataforma de auscultación clínica para estudiantes de kinesiología (Universidad de Valparaíso).

Es la capa que toca SQL Server y MongoDB. Recibe requests del **Controlador** (puerto 3023), nunca expone su puerto público fuera de la red interna en producción.

> **📦 Repositorios del proyecto Auris** — el código definitivo está en la rama **`unification`** de cada repo:
> - **App (estudiante + panel)**: https://github.com/App-Kine/app_kinesiologia_frontend
> - **Lógica** (negocio + datos + BD + correo) — este repo: https://github.com/App-Kine/app_kinesiologia_logica
> - **Controlador** (gateway / API): https://github.com/App-Kine/app_kinesiologia_controlador
>
> **Base de datos (para la revisión):** este repo incluye todo lo necesario en [`database/`](./database) — instalación ([`AurisDB_INSTALL.sql`](./database/AurisDB_INSTALL.sql)), guía paso a paso ([`SETUP.md`](./database/SETUP.md)) y respaldo/restauración ([`BACKUP.md`](./database/BACKUP.md)).

---

## 📋 Información para la revisión técnica (DTIC / Ciberseguridad)

Esta capa es el **backend de datos**: la única que toca SQL Server y MongoDB. Puerto **2000**, ruta base `/base_logica`. **No debe exponerse a internet** — en producción solo la alcanza el Controlador (3023) dentro de la red interna.

| Ítem solicitado | Sección |
|---|---|
| Descripción general | Encabezado + "Módulos clave" |
| Estructura de carpetas | "🗂 Estructura" |
| Tecnologías y versiones | "Tecnologías y versiones" (abajo) |
| Instalación y ejecución | "🚀 Setup para un dev nuevo" |
| Variables de entorno | "Variables de entorno requeridas" (abajo) |
| Credenciales de prueba | "Credenciales de prueba" (abajo) |
| Conexión a la base de datos | `database/SETUP.md` + "Conexión a la base de datos" (abajo) |
| Endpoints / servicios | "📚 Endpoints / servicios" |
| Tests / validación | "🧪 Tests y validación" (183 tests Jest) |
| Setup completo (3 repos) | [`SETUP_COMPLETO.md`](./SETUP_COMPLETO.md) |
| Seguridad / handoff producción | [`SEGURIDAD_PRODUCCION.md`](./SEGURIDAD_PRODUCCION.md) |

### Tecnologías y versiones

| Componente | Versión | Notas |
|---|---|---|
| Node.js | ≥ 18 (recomendado y probado en **20.x**) | — |
| Express | 4 (`express` ^4.17) | servidor HTTP |
| SQL Server | 2019+ (driver `mssql` ^8.1) | base `AurisDB` (datos) |
| MongoDB | 6+ — GridFS (driver `mongodb` ^6.21) | base `auris_media` (multimedia) |
| JWT | `jsonwebtoken` ^9 (algoritmo fijado **HS256**) | el control de auth lo aplica el Controlador |
| Hash de contraseñas | `bcryptjs` ^3, coste **12** | — |
| Uploads | `multer` ^1.4 (memoryStorage) | multimedia directa desde el frontend |
| Correo | `nodemailer` ^8 | invitaciones, reset de password, informes |
| Dev runner | `nodemon` ^3 | recarga en caliente |
| Tests | **Jest 29 — 183 tests** (`npm test`) | 15 suites, todas en verde |

> El proyecto **no usa TypeScript ni un framework adicional**: es JavaScript (CommonJS) sobre Express. Las versiones exactas están en [`package.json`](./package.json) (este repo es `base_logica` v1.0.5, `base_version` 3.0.0).

### Variables de entorno requeridas

En **desarrollo** la config se arma desde `env/development.js` y, si existe, `env/local.js` la **sobreescribe** (merge profundo; `localDatabases` reemplaza a `databases`). Si hay `env/local.js`, `NODE_ENV` interno pasa a `local`. En **producción** (`NODE_ENV=production`, archivo `env/production.js`) los valores se toman de `process.env` (ver [`.env.example`](./.env.example)). Tabla exhaustiva en [`CONFIG_REFERENCE.md`](./CONFIG_REFERENCE.md):

| Variable | Descripción | Ejemplo |
|---|---|---|
| `PORT` | Puerto del servicio | `2000` |
| `NODE_ENV` | Entorno (`development`/`production`) | `production` |
| `DB_HOST` / `DB_PORT` | Host y puerto de SQL Server | `localhost` / `1433` |
| `DB_USER` / `DB_PASS` | Credenciales SQL | `sa` / `••••••` |
| `DB_NAME` | Base de datos | `AurisDB` |
| `MONGO_URI` / `MONGO_DB` | MongoDB (multimedia) | `mongodb://localhost:27017` / `auris_media` |
| `JWT_SECRET` | **Secreto JWT — debe ser idéntico en el Controlador** | (≥ 32 chars aleatorios) |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | Expiración de tokens | `8h` / `7d` |
| `BCRYPT_ROUNDS` | Coste de bcrypt | `12` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | Servidor de correo saliente | `smtp.gmail.com` / `465` / `true` |
| `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | Cuenta de envío de informes/invitaciones | … |
| `MAIL_MODE` | `smtp` (envía de verdad) o **cualquier otro valor** (`dev`/`console`) = solo loguea en consola, no envía | `smtp` |
| `CORS_ORIGINS` | Orígenes permitidos, separados por coma | `https://panel.uv.cl` |
| `FRONTEND_BASE_URL` | URL del panel (links de invitación) | `https://panel.uv.cl` |
| `INVITACION_EXPIRA_HORAS` | Vencimiento de invitaciones de profesor (default `24`; **el código lo limita a un máximo de 48h** por RNF-12) | `24` |
| `LOG_JSON` | `1` = logs estructurados en JSON | `1` |

> ⚠️ **Producción:** `JWT_SECRET` debe ser un valor **fuerte y único** (NO el de desarrollo) y las credenciales de SQL/SMTP deben ser propias del entorno productivo. No reutilizar los valores de `env/local.js`.

### Conexión a la base de datos

Paso a paso completo en **[`database/SETUP.md`](database/SETUP.md)**. Resumen:

1. **SQL Server** — crear la base ejecutando [`database/AurisDB_INSTALL.sql`](database/AurisDB_INSTALL.sql): crea el esquema `auris`, todas las tablas, índices, constraints y datos de demo. Para **producción** usar [`database/PROD_db_user.sql`](database/PROD_db_user.sql) (usuario de BD con privilegios mínimos) y [`database/PROD_superadmin.sql`](database/PROD_superadmin.sql) (sin usuarios de demo; solo un superadmin con contraseña fuerte), más los índices de rendimiento [`AurisDB_MIGRATION_indices_dueno.sql`](database/AurisDB_MIGRATION_indices_dueno.sql) y [`AurisDB_MIGRATION_indices_rendimiento.sql`](database/AurisDB_MIGRATION_indices_rendimiento.sql).
2. **MongoDB** — inicializar los buckets GridFS con [`database/mongodb/init_mongo.js`](database/mongodb/init_mongo.js).
3. Configurar la conexión en `env/local.js` (dev) o vía variables de entorno (prod).

Respaldos y restauración: **[`database/BACKUP.md`](database/BACKUP.md)**.

### Credenciales de prueba

Tras instalar con `AurisDB_INSTALL.sql`, el login (desde el **panel docente** de la app → Controlador) acepta estas cuentas de demo:

| Correo | Contraseña | Rol |
|---|---|---|
| `admin@auris.local` | `ChangeMe!2026` | SUPERADMIN + PROFESOR |
| `superadmin@auris.local` | `ChangeMe!2026` | SUPERADMIN |
| `juan.perez@auris.local` | `ChangeMe!2026` | PROFESOR |

> Cuentas **solo para pruebas**. En producción se carga únicamente `PROD_superadmin.sql` (un superadmin con contraseña fuerte y única). La app del estudiante es pública y **no requiere credenciales**.

---

## 🧭 ¿Dónde encaja esto?

Auris está partido en **3 repos**:

```
              ┌─────────────────────────────────┐
              │  app_kinesiologia_frontend      │
              │  APP UNIFICADA (web + móvil)    │
              │  Estudiante (público, sin login)│
              │  + Panel docente (login JWT)    │
              │  Ionic + Angular + Capacitor    │
              │  :4201                          │
              └────────────────┬────────────────┘
                               │  HTTP (público) + JWT (panel)
                               │
              ┌──────────▼──────────┐
              │  app_kinesiologia   │
              │  _controlador       │
              │  Express + JWT      │
              │  :3023              │
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │  app_kinesiologia   │ ← TÚ ESTÁS ACÁ
              │  _logica            │
              │  Express + mssql    │
              │  :2000              │
              └────┬─────────────┬──┘
                   │             │
            ┌──────▼──────┐  ┌───▼────────────┐
            │ SQL Server  │  │  MongoDB GridFS│
            │ :1433       │  │  :27017        │
            │ AurisDB     │  │  auris_media   │
            │ (datos)     │  │  (audios/img/  │
            │             │  │   videos)      │
            └─────────────┘  └────────────────┘
```

**Regla de oro:** la lógica nunca se contacta directo desde el frontend (excepto multimedia, ver más abajo). Todo va por el controlador, que inyecta el JWT.

---

## 📦 Stack

- **Node.js 20.x** + **Express 4**
- **SQL Server 2019+** (instancia nativa o existente) — driver `mssql`
- **MongoDB 6+** + GridFS — driver `mongodb` (multimedia)
- **nodemailer** + Gmail SMTP (invitaciones, recuperación de password, informes)
- **jsonwebtoken v9** (firma/verifica con algoritmo fijado **HS256**) + **bcryptjs** (auth)
- **multer** (uploads de archivos directos a la lógica)
- **CORS por allowlist** (`CORS_ORIGINS`) para la subida directa de multimedia desde el frontend

---

## 🗂 Estructura

```
app_kinesiologia_logica/
├── base/                       # framework genérico (NO modificar sin necesidad)
│   ├── routes/base.router.js   # endpoints utilitarios
│   └── utils/
│       ├── db.js               # pool MSSQL (db.request("auris"))
│       ├── mongo.js            # buckets GridFS (audios/imágenes/videos)
│       ├── jwtAuth.js          # middleware requireRole("PROFESOR")
│       ├── mailer.js           # nodemailer (modo dev | smtp)
│       ├── reply.js            # envelope { status, data | error }
│       ├── logConsola.js       # logger global
│       └── loadConfig.js       # carga env/local|development|production.js
├── proyecto/
│   ├── routes/                 # routers Express (mapean ruta → service)
│   │   ├── auth.router.js          # login
│   │   ├── invitacion.router.js    # crear/verificar/completar/listar invitaciones
│   │   ├── password.router.js      # solicitarReset, resetearPassword, cambiarPassword
│   │   ├── usuario.router.js       # listarUsuarios, cambiarEstadoUsuario (admin)
│   │   ├── curso.router.js
│   │   ├── pregunta.router.js      # CRUD + agregar/quitar de test + exportarBanco (CSV)
│   │   ├── test.router.js
│   │   ├── aplicacion.router.js
│   │   ├── evaluacion.router.js    # flujo del estudiante (público)
│   │   ├── analitica.router.js
│   │   ├── multimedia.router.js    # GridFS (multer)
│   │   └── health.router.js        # /healthz /readyz /health /metrics (sin prefijo)
│   ├── services/               # validación, JWT, bcrypt, orquestación
│   └── repositories/           # ÚNICA capa que hace queries SQL/Mongo
├── database/
│   ├── AurisDB_INSTALL.sql                       # instalación completa (schema + seed), idempotente — CANÓNICO
│   ├── AurisDB_MIGRATION_indices_dueno.sql       # índices por dueño (rendimiento)
│   ├── AurisDB_MIGRATION_indices_rendimiento.sql # índices adicionales de rendimiento
│   ├── PROD_db_user.sql        # usuario de BD con privilegios mínimos (producción)
│   ├── PROD_superadmin.sql     # seed del superadmin para producción (clave fuerte)
│   ├── mongodb/
│   │   ├── init_mongo.js       # init de buckets GridFS
│   │   └── SETUP_MONGO.md      # guía de Mongo
│   ├── BACKUP.md               # estrategia de backup/restore
│   └── SETUP.md                # guía paso a paso de la BD
├── env/
│   ├── development.js          # defaults compartibles
│   ├── production.js
│   ├── local.js.example        # PLANTILLA (sí versionada)
│   └── local.js                # ⚠ tu copia local con SECRETS (gitignored)
├── tests/                      # 183 tests Jest (services, repositories, utils)
├── .env.example                # plantilla de variables para producción
├── CONFIG_REFERENCE.md         # referencia exhaustiva de toda la config
├── SETUP_COMPLETO.md           # guía de los 3 repos en una máquina nueva
├── SEGURIDAD_PRODUCCION.md     # checklist de handoff para DTIC / Ciberseguridad
├── config.js, index.js, routes.js
└── package.json
```

---

## 🚀 Setup para un dev nuevo (10 min)

### 1. Tener SQL Server + MongoDB disponibles

Usa tu instancia de **SQL Server 2019+** y **MongoDB 6+** (las que ya tengas o
una instalación nativa). **No requiere Docker.**

> *Solo para desarrollo local en Mac Apple Silicon (opcional):* si no tienes SQL
> Server nativo, puedes levantar uno con Docker usando la imagen `azure-sql-edge`
> (ARM) + `mongo:6`. Es opcional y solo para el equipo de desarrollo.

### 2. Instalar la base de datos

Con **SSMS**, **Azure Data Studio**, **DBeaver** o **sqlcmd**, ejecutá
`database/AurisDB_INSTALL.sql` contra el servidor. Es un único script
**idempotente** (crea esquema + datos seed; podés correrlo varias veces sin
duplicar). Detalle paso a paso: [`database/SETUP.md`](./database/SETUP.md).

### 3. Inicializar buckets de Mongo

El script es de **`mongosh`** (viene con MongoDB), no de Node. Pásale tu URI + `/auris_media`:

```bash
mongosh "mongodb://localhost:27017/auris_media" database/mongodb/init_mongo.js
```

> Detalle en [`database/mongodb/SETUP_MONGO.md`](./database/mongodb/SETUP_MONGO.md). Mongo es **opcional**: si no está disponible, la lógica igual arranca y solo se deshabilitan los endpoints de multimedia.

### 4. Configurar credenciales locales

```bash
cp env/local.js.example env/local.js
# editá env/local.js: SQL password, JWT secret, Gmail SMTP (opcional)
```

⚠️ **`env/local.js` está en `.gitignore`** — nunca lo subas. Si tu compañero necesita las credenciales, pasalas por canal seguro (no por git ni Slack público).

### 5. Instalar y arrancar

`npm install` ya instala `nodemon` (devDependency), no hace falta instalarlo global:

```bash
npm install
npm run dev-unix      # Mac/Linux → NODE_ENV=development nodemon index.js
# Windows:  npm run dev
# Producción: npm run prod-unix   (Mac/Linux)  /  npm run prod  (Windows)
```

Verás algo como:
```
[base_logica] Env: LOCAL, Port: 2000, Path: /base_logica, Tipo: LOGICA, v: 1.0.5
```

La lógica queda escuchando en `http://localhost:2000/base_logica/`. En desarrollo puedes sondear su salud sin tocar la BD:

```bash
curl http://localhost:2000/healthz     # liveness  → 200 si el proceso vive
curl http://localhost:2000/readyz      # readiness → 200 si SQL responde
curl http://localhost:2000/health      # estado detallado (SQL + Mongo)
```

---

## 🛠 Convenciones del código

### Envelope de respuesta

Toda respuesta sale como uno de estos dos shapes:
```js
{ status: "OK",    data: {...} }      // reply.ok(data)
{ status: "ERROR", error: {...} }     // reply.error(msg) / reply.fatal(e)
```
Definido en `base/utils/reply.js`.

### Body de POST

El controlador manda el body como `arg=urlencoded(JSON.stringify(params))`.
Todos los services desempacan así:
```js
function _leerArg(request) {
  if (request.body && typeof request.body.arg === "string") {
    return JSON.parse(request.body.arg);
  }
  return request.body || {};
}
```
**Excepción**: multimedia recibe `multipart/form-data` directo desde el frontend (con `multer`), no usa este patrón.

### Pool de SQL Server

```js
const db = require("../../base/utils/db");
const r = await db.request("auris")
  .input("usuario_id", db.sql.BigInt, userId)
  .query(`SELECT ... FROM auris.usuario WHERE usuario_id = @usuario_id`);
// para transacciones:
const pool = db.getPool("auris");
const tx = new db.sql.Transaction(pool);
await tx.begin();
// ... .input/.query con new db.sql.Request(tx) ...
await tx.commit();
```

Siempre con **parámetros bindeados** (`.input()`), nunca concatenando strings → anti-inyección automático.

### Buckets de Mongo

```js
const mongo = require("../../base/utils/mongo");
if (!mongo.isReady()) { return reply.error("Mongo no disponible"); }
const bucket = mongo.bucketAudios();   // o bucketImagenes(), bucketVideos()
```

Mongo es **opcional**: si no está disponible, la app igual arranca, solo deshabilita los endpoints de multimedia.

### Autenticación JWT

```js
const { requireRole } = require("../../base/utils/jwtAuth");

router.post("/multimedia/subirAudio",
  requireRole("PROFESOR"),
  upload.single("archivo"),
  services.subirAudio
);
```

El middleware pone `request.usuario = { sub, correo, nombre, roles }`. Los services nunca confían en `creadoPor` del body para auth — siempre lo inyecta el controlador desde el JWT.

### Soft delete

Nada se borra físicamente. Convención: `UPDATE ... SET activo = 0`. Conserva históricos para analítica e informes.

---

## 🎯 Módulos clave (qué resuelve cada uno)

| Módulo | Cubre | Notas |
|---|---|---|
| `auth` | login + emisión de tokens, bloqueo por intentos | bcrypt cost 12; `/login` emite access (8h) + refresh (7d, guardado hasheado). El refresh se renueva en el Controlador, no hay endpoint de refresh en esta capa |
| `invitacion` | admin invita docente por email | token único 24h |
| `password` | recuperación + reset por email | token único |
| `curso` | CRUD cursos del docente | soft-delete |
| `pregunta` | CRUD preguntas con multimedia | rich text HTML, 2-5 alternativas |
| `test` | CRUD tests + vincular preguntas | **cascade**: eliminar test desactiva aplicaciones |
| `aplicacion` | docente aplica test a curso | con ventana visible_desde/hasta |
| `evaluacion` | flujo del estudiante (público, sin login) | tiempo por pregunta, informe completo PDF |
| `analitica` | dashboards del docente | timing individual (identificados) + promedio (anónimos) |
| `multimedia` | upload/stream de audio/imagen/video | GridFS, Range para seek |

---

## 🧪 Tests y validación

**Suite de pruebas (Jest):** 183 tests en 15 suites (services, repositories, utils). No requieren BD real — usan mocks/stubs.

```bash
npm test               # corre las 183 pruebas (jest --runInBand)
npm run test:coverage  # con reporte de cobertura (umbral mínimo: 60% líneas)
npm run test:watch     # modo watch durante el desarrollo
```

Salida esperada:
```
Test Suites: 15 passed, 15 total
Tests:       183 passed, 183 total
```

**Validación rápida de sintaxis** (sin levantar nada):
```bash
find proyecto base -name "*.js" -not -path "*/node_modules/*" \
  -exec node --check {} \;
# (sin output = OK)
```

**Formato (Prettier):** `npm run prettier-c` (check) / `npm run prettier-w` (write).

---

## 📚 Endpoints / servicios

Todos los servicios de negocio van por `POST http://localhost:2000/base_logica/<ruta>` (los health checks van **sin** prefijo: `/healthz`, `/readyz`, `/health`, `/metrics`).

> El control de auth/rol lo aplica el **Controlador** (3023) **antes** de reenviar acá; esta capa es interna. La columna "Auth" describe esa exigencia que impone el controlador. El body de los POST llega envuelto como `arg=urlencoded(JSON.stringify(params))`, salvo multimedia (multipart).

### Mapa de servicios por módulo

| Módulo | Rutas (POST salvo indicación) | Auth | Propósito |
|---|---|---|---|
| **auth** | `/login` | Público | Login (correo+password), emite access/refresh JWT |
| **password** | `/solicitarReset`, `/resetearPassword` | Público | Recuperación de contraseña por email (token único) |
| | `/cambiarPassword` | JWT (logueado) | Cambio de contraseña del usuario autenticado |
| **invitacion** | `/verificarInvitacion`, `/completarInvitacion` | Público | El docente invitado valida el token y crea su cuenta |
| | `/crearInvitacion`, `/listarInvitaciones` | JWT SUPERADMIN | Admin invita/lista docentes |
| **usuario** | `/listarUsuarios`, `/cambiarEstadoUsuario` | JWT SUPERADMIN | Gestión de usuarios (alta/baja lógica) |
| **curso** | `/cursos/listar`, `/cursos/detalle`, `/cursos/misCursos`, `/cursos/crear`, `/cursos/obtener`, `/cursos/editar`, `/cursos/eliminar`, `/cursos/ping` | JWT PROFESOR | CRUD de cursos del docente (soft-delete) |
| **pregunta** | `/crearPregunta`, `/listarPreguntas`, `/obtenerPregunta`, `/editarPregunta`, `/eliminarPregunta`, `/agregarPreguntaATest`, `/quitarPreguntaDeTest`, `/exportarBanco` | JWT PROFESOR | Banco de preguntas (HTML + multimedia) y export CSV |
| **test** | `/crearTest`, `/listarTests`, `/obtenerTest`, `/editarTest`, `/eliminarTest` | JWT PROFESOR | CRUD de tests y vínculo con preguntas |
| **aplicacion** | `/crearAplicacion`, `/listarAplicaciones`, `/setActivoAplicacion`, `/eliminarAplicacion` | JWT PROFESOR | Aplicar un test a un curso (ventana de visibilidad) |
| **analitica** | `/analitica/resumen`, `/analitica/aplicacion` | JWT PROFESOR | Dashboards del docente (timing, promedios) |
| **evaluacion** | `/evaluacion/aplicacionesActivas`, `/evaluacion/iniciar`, `/evaluacion/corregir`, `/evaluacion/enviar` | Público | Flujo del estudiante (sin login). `corregir`/`enviar` = flujo vigente "no persistir incompletas" |
| | `/evaluacion/enviarInforme`, `/evaluacion/informeCompleto` | Público | **Vigentes** — envío del informe por correo (idempotente, PDF adjunto validado) y detalle pregunta a pregunta de una evaluación finalizada |
| | `/evaluacion/responder`, `/evaluacion/finalizar` | Público | **Deprecados** — devuelven error pidiendo migrar a `/corregir` + `/enviar` |
| **multimedia** | `/multimedia/subirAudio`, `/multimedia/subirImagen`, `/multimedia/subirVideo`, `/multimedia/eliminar` | JWT PROFESOR | Subida (multipart, GridFS) y borrado |
| | `GET /multimedia/audio/:id`, `/imagen/:id`, `/video/:id` | Público | Streaming con soporte `Range` (seek) |
| **health** | `GET /healthz`, `/readyz`, `/health`, `/metrics` (sin prefijo) | Público (interno) | Liveness, readiness, estado detallado y métricas |

---

## 🐛 Troubleshooting

**`EADDRINUSE puerto 2000`** → ya hay otra instancia corriendo. `lsof -i :2000` y `kill -9 PID`.

**`Login failed for user 'sa'`** → la password en `env/local.js` no coincide con la de tu SQL Server. Verificá ambas.

**`ECONNREFUSED 127.0.0.1:27017`** → Mongo no está corriendo. Multimedia se va a deshabilitar pero el resto funciona. Levantá Mongo si lo necesitás.

**SMTP rechaza con `Username and Password not accepted`** → la App Password de Gmail está vencida o la cuenta perdió 2FA. Regenerá en https://myaccount.google.com/apppasswords.

**`MongoDB no está disponible`** al subir un archivo → idem ECONNREFUSED. Asegurate que el contenedor esté arriba.

---

## 🤝 Convenciones de equipo

- **No commitear `package-lock.json`** (está en `.gitignore`).
- **No commitear `env/local.js`** ni nada con secrets.
- Mantener los `env/local.js.example` actualizados cuando agregás un nuevo bloque de config.
- Los cambios de schema SQL se consolidan en `database/AurisDB_INSTALL.sql` (script único e idempotente; mantenelo como fuente de verdad del esquema).
- El JWT secret en este repo **debe coincidir EXACTAMENTE** con el del controlador.

---

## 📌 Referencias

- SRS / casos de uso: `database/SETUP.md` y los comentarios `RF-XX` en el código apuntan al documento de requisitos.
- Esquema y datos seed: `database/AurisDB_INSTALL.sql` (script único e idempotente).
- **Producción / seguridad:** [`SEGURIDAD_PRODUCCION.md`](./SEGURIDAD_PRODUCCION.md) — checklist de handoff para DTIC (HTTPS, secretos, usuario de BD `PROD_db_user.sql`, seed `PROD_superadmin.sql`).
- Variables de entorno: [`CONFIG_REFERENCE.md`](./CONFIG_REFERENCE.md). Setup completo: [`SETUP_COMPLETO.md`](./SETUP_COMPLETO.md).
