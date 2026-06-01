# Configuración — Referencia completa

Tabla exhaustiva de todas las variables de configuración disponibles en
`env/local.js` (lógica) y `env/local.js` (controlador). Producto del
Bloque P3.R11 (auditoría ISO 25010, Adaptabilidad).

## Filosofía

`env/local.js` **sobreescribe** `env/development.js`. Solo declara los
campos que quieres cambiar para tu entorno; el resto los hereda del
default. `env/local.js` NO se versiona (está en `.gitignore`).

## Variables de la LÓGICA (`app_kinesiologia_logica/env/local.js`)

### `localDatabases[]`

Lista de pools de SQL Server. Auris usa solo uno con `code: "auris"`.

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `code` | string | — | Identificador interno. Siempre `"auris"` para Auris. |
| `server` | string | — | Host del SQL Server. Ej. `"localhost"`, `"localhost\\SQLEXPRESS"`. |
| `port` | int | 1433 | Solo cambiar si el servidor escucha en otro puerto. |
| `user` | string | — | Login. Típicamente `"sa"` para dev. |
| `password` | string | — | Password del login. **NUNCA en git.** |
| `database` | string | — | Nombre de la BD. Siempre `"AurisDB"`. |
| `options.encrypt` | bool | `true` | Habilita TLS. Mantener `true`. |
| `options.trustServerCertificate` | bool | `true` | En dev `true`; en prod usar cert real. |
| `pool.max` | int | 10 | Conexiones simultáneas. Aumentar para alta concurrencia (validado en P1.R2). |
| `pool.min` | int | 0 | Conexiones idle mínimas. |
| `pool.idleTimeoutMillis` | int | 30000 | Cierre de conexiones inactivas (ms). |

**Consecuencias de cambios:**

- `pool.max` muy bajo + muchos usuarios → requests bloqueados esperando conexión.
- `pool.max` muy alto + SQL Server modesto → SQL Server se satura.
- Recomendación con backend medio: `max = 30-50` para 100+ usuarios concurrentes.

### `security`

Política de autenticación.

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `jwtSecret` | string | — | Secreto HS256. **Debe coincidir con el del controlador.** Mínimo 32 chars random. |
| `jwtAccessExpiresIn` | string | `"8h"` | Vida del access token (RNF-17). Formato JWT (`"1h"`, `"15m"`, `"8h"`). |
| `jwtRefreshExpiresIn` | string | `"7d"` | Vida del refresh token (RNF-17, máx 7d). |
| `bcryptRounds` | int | 12 | Coste bcrypt (RNF-11). 12 = buen balance; 14 = más seguro pero más lento. |
| `loginBlockMaxAttempts` | int | 5 | Fallos antes de bloquear IP (RF-60). |
| `loginBlockWindowMinutes` | int | 15 | Ventana de conteo del bloqueo (RF-60). |

**Consecuencias:**

- `bcryptRounds` = 14 → login ~4× más lento, ~16× más resistente a brute force offline.
- `loginBlockMaxAttempts` = 3 → más estricto, riesgo de auto-bloqueo de docentes que se equivocan al tipear.

### `mail`

Envío de correos (invitaciones de profesor + recuperación de password).

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `mode` | `"dev"` \| `"smtp"` | `"dev"` | `"dev"` imprime el correo en consola. `"smtp"` lo envía de verdad. |
| `from` | string | — | Remitente. Ej. `"Auris <no-reply@auris.local>"`. |
| `smtp.host` | string | — | Servidor SMTP. Para Gmail: `"smtp.gmail.com"`. |
| `smtp.port` | int | 465 | 465 (SSL) o 587 (STARTTLS). |
| `smtp.secure` | bool | true | `true` para 465; `false` para 587. |
| `smtp.user` | string | — | Cuenta de envío. |
| `smtp.password` | string | — | App Password para Gmail (16 chars sin espacios). **NUNCA en git.** |

**Consecuencias:**

- `mode: "dev"` en producción → los usuarios nunca reciben invitaciones / reset.
- `smtp.password` con la contraseña normal (no App Password) → Gmail bloquea el envío.

### `frontend`

Apunta a dónde corre el frontend, usado para construir los links de
invitación que viajan por correo.

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `baseUrl` | string | `"http://localhost:4200"` | URL base del panel. Si el panel corre en otro puerto, cambiar. |

### `invitaciones`

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `expiraHoras` | int | 24 | Vida útil de un token de invitación. Máximo 48h (RNF-12). |

### `mongo`

GridFS para multimedia (audios, imágenes, videos).

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `uri` | string | `"mongodb://localhost:27017"` | Connection string. Atlas: `"mongodb+srv://..."`. |
| `database` | string | `"auris_media"` | Nombre de la BD Mongo. |

### `errorTracking` (P2.R6)

Integración opcional con Sentry. Vacío = desactivado.

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `dsn` | string | `""` | DSN del proyecto Sentry. Vacío = tracker desactivado. |
| `environment` | string | `"development"` | Etiqueta del environment en Sentry. |
| `tracesSampleRate` | float 0..1 | 0.0 | % de transacciones tracked. 0.1 = 10%. |
| `release` | string | — | ID del release para correlar errors con código. Ej. `"auris@1.0.5"`. |

**Consecuencias:**

- `dsn` vacío: los errores van solo a logs locales. Funciona pero no hay alertas remotas.
- `tracesSampleRate: 1.0`: tracea TODA transacción → costo Sentry alto.

## Variables del CONTROLADOR (`app_kinesiologia_controlador/env/local.js`)

### `servidores`

A dónde reenvía cada llamada el controlador.

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `serv_udalba_logica.host` | string | `"localhost"` | Host de la lógica. |
| `serv_udalba_logica.port` | int | 2000 | Puerto de la lógica. |
| `serv_udalba_logica.path` | string | `"/base_logica"` | Prefijo del API. |

### `security`

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `jwtSecret` | string | — | **DEBE coincidir con `security.jwtSecret` de la lógica.** |
| `jwtAccessExpiresIn` | string | `"8h"` | Igual a la lógica. |

## Variables de los FRONTENDS

Los frontends no usan `env/local.js`. Usan `environment.ts` y `environment.prod.ts`.

### `app_kinesiologia_panel/src/environments/environment.ts`

| Campo | Tipo | Default | Notas |
|---|---|---|---|
| `production` | bool | `false` | `true` en `environment.prod.ts`. |
| `apiUrl` | string | `"http://localhost:3000/controlador_base/"` | URL del controlador. |
| `LOGICA_API_URL` | string | `"http://localhost:2000/base_logica/"` | Para multimedia GET directo. |

### `app_kinesiologia_frontend/src/environments/environment.ts`

Igual al panel.

## Variables del SETUP de servidor (no en código)

| Variable | Cómo se setea | Notas |
|---|---|---|
| `NODE_ENV` | `npm run dev-unix` la setea a `"development"` | Detectada por `loadConfig`. |
| Password SA SQL Server | Al instalar SQL Server | Debe coincidir con `localDatabases[0].password`. |
| Password Mongo (opcional) | `--auth` al iniciar mongod | Sumar a `mongo.uri` con `mongodb://user:pass@...`. |

## Reglas operacionales

### Producción

- `bcryptRounds` ≥ 12.
- `jwtSecret` mínimo 32 chars random (no diccionario).
- `mail.mode = "smtp"` con cuenta dedicada.
- `errorTracking.dsn` poblado.
- `options.trustServerCertificate = false` + cert válido del SQL Server.
- HTTPS en frente del controlador (nginx, Cloudflare).
- `app.set("trust proxy", 1)` en `controlador/app.js` si hay nginx delante.

### Desarrollo local

- Defaults de `local.js.example` son seguros.
- `mode: "dev"` para no mandar correos por error.
- `errorTracking.dsn` vacío.

### Migración entre entornos

```
dev → staging:  cambiar mail.mode → "smtp" + DSN Sentry
staging → prod: cambiar jwtSecret + bcryptRounds + cert real SQL Server
```

## Cómo verificar la configuración

Endpoint `/health` (P2.R7) imprime:

```json
{
  "status": "ok",
  "service": "auris-logica",
  "version": "1.0.5",
  "uptime_seconds": 1820,
  "node_version": "v20.19.0",
  "checks": {
    "sql":   { "ok": true, "latency_ms": 8 },
    "mongo": { "ok": true, "latency_ms": 3 }
  }
}
```

Si `checks.sql.ok = false`: revisar `localDatabases` (host, password).
Si `checks.mongo.ok = false`: revisar `mongo.uri` o que mongod esté corriendo.

## Glosario de archivos

| Archivo | Propósito |
|---|---|
| `config.js` | Constantes globales del repo (puerto, rootPath). Versionado. |
| `env/development.js` | Defaults para `NODE_ENV=development`. Versionado. |
| `env/production.js` | Defaults para `NODE_ENV=production`. Versionado. |
| `env/local.js` | Overrides locales por developer. **NO versionado.** |
| `env/local.js.example` | Plantilla con instrucciones. Versionado. |
| `base/utils/loadConfig.js` | Carga y merge de los tres anteriores. |
