# Auris · Capa Lógica

Backend con la lógica de negocio del MVP de **Auris** — plataforma de auscultación clínica para estudiantes de kinesiología (Universidad de Valparaíso).

Es la capa que toca SQL Server y MongoDB. Recibe requests del **Controlador** (puerto 3023), nunca expone su puerto público fuera de la red interna en producción.

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
| Endpoints / servicios | "📚 Endpoints" |

### Tecnologías y versiones

| Componente | Versión |
|---|---|
| Node.js | ≥ 18 (probado en 20.x) |
| Express | 4 |
| SQL Server | 2019+ (driver `mssql` 8) |
| MongoDB | 6 — GridFS para multimedia (driver `mongodb` 6) |
| JWT | `jsonwebtoken` 9 (HS256) |
| Hash de contraseñas | `bcryptjs`, coste 12 |
| Correo | `nodemailer` 8 |
| Tests | Jest 29 (28 tests, `npm test`) |

### Variables de entorno requeridas

En **desarrollo** se leen de `env/local.js` / `env/development.js`. En **producción** (`NODE_ENV=production`) se leen de `process.env` (ver `.env.example`):

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
| `MAIL_MODE` | `smtp` (envía) o `console` (solo log, no envía) | `smtp` |
| `CORS_ORIGINS` | Orígenes permitidos, separados por coma | `https://panel.uv.cl` |
| `FRONTEND_BASE_URL` | URL del panel (links de invitación) | `https://panel.uv.cl` |
| `INVITACION_EXPIRA_HORAS` | Vencimiento de invitaciones de profesor | `72` |
| `LOG_JSON` | `1` = logs estructurados en JSON | `1` |

> ⚠️ **Producción:** `JWT_SECRET` debe ser un valor **fuerte y único** (NO el de desarrollo) y las credenciales de SQL/SMTP deben ser propias del entorno productivo. No reutilizar los valores de `env/local.js`.

### Conexión a la base de datos

Paso a paso completo en **[`database/SETUP.md`](database/SETUP.md)**. Resumen:

1. **SQL Server** — crear la base ejecutando [`database/AurisDB_INSTALL.sql`](database/AurisDB_INSTALL.sql): crea el esquema `auris`, todas las tablas, índices, constraints y datos de demo. Para **producción** usar [`database/PROD_superadmin.sql`](database/PROD_superadmin.sql) (sin usuarios de demo; solo un superadmin con contraseña fuerte) + [`database/AurisDB_MIGRATION_indices_dueno.sql`](database/AurisDB_MIGRATION_indices_dueno.sql) (índices de rendimiento).
2. **MongoDB** — inicializar los buckets GridFS con [`database/mongodb/init_mongo.js`](database/mongodb/init_mongo.js).
3. Configurar la conexión en `env/local.js` (dev) o vía variables de entorno (prod).

Respaldos y restauración: **[`database/BACKUP.md`](database/BACKUP.md)**.

### Credenciales de prueba

Tras instalar con `AurisDB_INSTALL.sql`, el login (a través del Panel → Controlador) acepta estas cuentas de demo:

| Correo | Contraseña | Rol |
|---|---|---|
| `admin@auris.local` | `ChangeMe!2026` | SUPERADMIN + PROFESOR |
| `superadmin@auris.local` | `ChangeMe!2026` | SUPERADMIN |
| `juan.perez@auris.local` | `ChangeMe!2026` | PROFESOR |

> Cuentas **solo para pruebas**. En producción se carga únicamente `PROD_superadmin.sql` (un superadmin con contraseña fuerte y única). La app del estudiante es pública y **no requiere credenciales**.

---

## 🧭 ¿Dónde encaja esto?

Auris está partido en **4 repos**:

```
┌──────────────────────┐    ┌──────────────────────┐
│  app_kinesiologia    │    │  app_kinesiologia    │
│  _panel              │    │  _frontend           │
│  (Panel docente WEB) │    │  (App estudiante     │
│  Angular + Ionic     │    │   móvil iOS/Android) │
│  :4200               │    │  Ionic + Capacitor   │
└──────────┬───────────┘    └──────────┬───────────┘
           │                           │
           │  HTTP + JWT               │  HTTP (público,
           │  (login docente)          │   sin login)
           └─────────────┬─────────────┘
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
│   ├── routes/                 # 12 routers Express
│   │   ├── auth.router.js
│   │   ├── invitacion.router.js
│   │   ├── password.router.js    # solicitarReset, resetearPassword, cambiarPassword
│   │   ├── usuario.router.js      # listarUsuarios, cambiarEstadoUsuario (admin)
│   │   ├── curso.router.js
│   │   ├── pregunta.router.js
│   │   ├── test.router.js
│   │   ├── aplicacion.router.js
│   │   ├── evaluacion.router.js
│   │   ├── analitica.router.js
│   │   ├── multimedia.router.js
│   │   └── ejemplo.router.js
│   ├── services/               # validación, JWT, bcrypt, orquestación
│   └── repositories/           # ÚNICA capa que hace queries SQL/Mongo
├── database/
│   ├── AurisDB_INSTALL.sql     # instalación completa (schema + seed), idempotente — CANÓNICO
│   ├── PROD_db_user.sql        # usuario de BD con privilegios mínimos (producción)
│   ├── PROD_superadmin.sql     # seed del superadmin para producción (clave fuerte)
│   ├── mongodb/init_mongo.js   # init de buckets GridFS
│   ├── BACKUP.md               # estrategia de backup/restore
│   └── SETUP.md                # guía paso a paso de la BD
├── env/
│   ├── development.js          # defaults compartibles
│   ├── production.js
│   ├── local.js.example        # PLANTILLA (sí versionada)
│   └── local.js                # ⚠ tu copia local con SECRETS (gitignored)
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

```bash
mongosh < database/mongodb/init_mongo.js
```

### 4. Configurar credenciales locales

```bash
cp env/local.js.example env/local.js
# editá env/local.js: SQL password, JWT secret, Gmail SMTP (opcional)
```

⚠️ **`env/local.js` está en `.gitignore`** — nunca lo subas. Si tu compañero necesita las credenciales, pasalas por canal seguro (no por git ni Slack público).

### 5. Instalar y arrancar

```bash
npm install
npm run dev-unix
# Mac/Linux: NODE_ENV=development nodemon index.js
# Windows: npm run dev
```

Verás:
```
[base_logica] Env: LOCAL, Port: 2000, Path: /base_logica, Tipo: LOGICA, v: 1.0.5
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
| `auth` | login, refresh, bloqueo por intentos | bcrypt cost 12, 8h access / 7d refresh |
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

## 🧪 Verificar que todo compile

```bash
# Validación rápida de sintaxis JS
find proyecto base -name "*.js" -not -path "*/node_modules/*" \
  -exec node --check {} \;
# (sin output = OK)
```

---

## 📚 Endpoints (mapa rápido)

Todos bajo `http://localhost:2000/base_logica/`.

> El control de auth/rol lo aplica el **controlador** antes de reenviar acá (la
> lógica es interna). La columna "Auth" describe esa exigencia.

**Públicos** (sin JWT): `login`, `evaluacion/*`, `verificarInvitacion`, `completarInvitacion`, `solicitarReset`, `resetearPassword`, `multimedia/audio|imagen|video/:id`

**Requieren JWT (usuario logueado)**: `cambiarPassword`

**Requieren JWT PROFESOR**: `pregunta/*`, `test/*`, `aplicacion/*`, `cursos/*`, `analitica/*`, `multimedia/subir*`, `multimedia/eliminar`

**Requieren JWT SUPERADMIN**: `crearInvitacion`, `listarInvitaciones`, `listarUsuarios`, `cambiarEstadoUsuario`

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
