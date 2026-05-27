# Auris · Capa Lógica

Backend con la lógica de negocio del MVP de **Auris** — plataforma de auscultación clínica para estudiantes de kinesiología (Universidad de Valparaíso).

Es la capa que toca SQL Server y MongoDB. Recibe requests del **Controlador** (puerto 3023), nunca expone su puerto público fuera de la red interna en producción.

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
- **SQL Server 2019+** (vía Docker en local) — driver `mssql`
- **MongoDB 6+** + GridFS — driver `mongodb` (multimedia)
- **nodemailer** + Gmail SMTP (invitaciones, recuperación de password, informes)
- **jsonwebtoken** + **bcryptjs** (auth)
- **multer** (uploads de archivos directos a la lógica)

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
│   ├── routes/                 # 11 routers Express
│   │   ├── auth.router.js
│   │   ├── invitacion.router.js
│   │   ├── password.router.js
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
│   ├── AurisDB_dump.sql        # schema + datos seed (canónico)
│   ├── 2026-05-25_*.sql        # migraciones incrementales
│   ├── 2026-05-26_video_y_timing.sql
│   ├── mongodb/init_mongo.js   # init de buckets GridFS
│   └── SETUP.md                # guía paso a paso de la BD
├── env/
│   ├── development.js          # defaults compartibles
│   ├── production.js
│   ├── local.js.example        # PLANTILLA (sí versionada)
│   └── local.js                # ⚠ tu copia local con SECRETS (gitignored)
├── scripts/                    # utilidades CLI (generar hash, verificar login)
├── config.js, index.js, routes.js
└── package.json
```

---

## 🚀 Setup para un dev nuevo (10 min)

### 1. Levantar SQL Server + MongoDB

```bash
# SQL Server (Mac/Linux con Docker)
docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=Martin131*" \
  -p 1433:1433 --name auris-sql -d \
  mcr.microsoft.com/azure-sql-edge:latest

# MongoDB
docker run -p 27017:27017 --name auris-mongo -d mongo:6
```

### 2. Restaurar el dump

Usá Azure Data Studio, DBeaver o sqlcmd para correr `database/AurisDB_dump.sql` contra el servidor.
Después corré las migraciones cronológicamente (`2026-05-25_*.sql`, `2026-05-26_*.sql`).
Detalle paso a paso: [`database/SETUP.md`](./database/SETUP.md).

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

**Públicos** (sin JWT): `auth/*`, `evaluacion/*`, `invitacion/verificar*`, `invitacion/completar*`, `password/*`, `multimedia/audio/:id`, `multimedia/imagen/:id`, `multimedia/video/:id`

**Requieren JWT PROFESOR**: `pregunta/*`, `test/*`, `aplicacion/*`, `curso/*`, `analitica/*`, `multimedia/subir*`, `multimedia/eliminar`

**Requieren JWT SUPERADMIN**: `invitacion/crear`, `invitacion/listar`

---

## 🐛 Troubleshooting

**`EADDRINUSE puerto 2000`** → ya hay otra instancia corriendo. `lsof -i :2000` y `kill -9 PID`.

**`Login failed for user 'sa'`** → password en `env/local.js` no coincide con el del contenedor Docker. Si reseteaste el container, regenerá el password o el container.

**`ECONNREFUSED 127.0.0.1:27017`** → Mongo no está corriendo. Multimedia se va a deshabilitar pero el resto funciona. Levantá Mongo si lo necesitás.

**SMTP rechaza con `Username and Password not accepted`** → la App Password de Gmail está vencida o la cuenta perdió 2FA. Regenerá en https://myaccount.google.com/apppasswords.

**`MongoDB no está disponible`** al subir un archivo → idem ECONNREFUSED. Asegurate que el contenedor esté arriba.

---

## 🤝 Convenciones de equipo

- **No commitear `package-lock.json`** (está en `.gitignore`).
- **No commitear `env/local.js`** ni nada con secrets.
- Mantener los `env/local.js.example` actualizados cuando agregás un nuevo bloque de config.
- Cualquier cambio de schema SQL va como migración nueva en `database/YYYY-MM-DD_descripcion.sql`. **No editar `AurisDB_dump.sql` para fixes incrementales.**
- El JWT secret en este repo **debe coincidir EXACTAMENTE** con el del controlador.

---

## 📌 Referencias

- SRS / casos de uso: `database/SETUP.md` y los comentarios `RF-XX` en el código apuntan al documento de requisitos.
- Migración SQL más reciente: `database/2026-05-26_video_y_timing.sql` (agrega `pregunta.video_grid_id` y `respuesta_pregunta.tiempo_segundos`).
