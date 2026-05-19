# Auris · Capa Lógica

Backend Node.js + Express + SQL Server (`mssql`) que implementa la lógica de negocio del MVP de Auris (app de auscultación clínica para estudiantes de kinesiología).

## Stack

- Node.js / Express
- SQL Server 2019+ / Azure SQL Edge (vía Docker en local)
- `mssql` (driver), `bcryptjs`, `jsonwebtoken`

## Arquitectura interna

```
routes/        → endpoints Express
services/      → lógica de negocio (validación, JWT, bcrypt)
repositories/  → única capa que ejecuta SQL contra el esquema auris.*
utils/         → db pool, mailer, reply, logger, loadConfig
```

## Setup rápido para un nuevo desarrollador

1. **Levanta SQL Server y restaura el dump** → ver [database/SETUP.md](./database/SETUP.md)
2. **Instala dependencias y configura el entorno:**

```bash
npm install
cp env/local.js.example env/local.js
# Edita env/local.js con tu password de SQL Server
```

3. **Arranca:**

```bash
npm run dev-unix    # macOS / Linux
npm run dev         # Windows
```

Si todo va bien verás:

```
[base_logica] Config: listo
[db] Pool "auris" -> localhost:1433/AurisDB listo
[base_logica] Databases: listo
[base_logica] Env: LOCAL, Port: 2000, Path: /base_logica
```

## Endpoints actuales

| Método | URL | Auth | Cubre |
|---|---|---|---|
| POST | `/base_logica/login` | público | RF-52, RF-53 |
| POST | `/base_logica/crearInvitacion` | vía controlador admin | RF-76, RF-77 |
| POST | `/base_logica/verificarInvitacion` | público | RF-79 |
| POST | `/base_logica/completarInvitacion` | público | RF-80, RF-81 |
| POST | `/base_logica/listarInvitaciones` | vía controlador admin | RF-83 |
| POST | `/base_logica/cursos/listar` | abierto | RF-02 |
| POST | `/base_logica/cursos/ping` | abierto | health-check |

> Nota: el frontend NUNCA habla directo con esta capa. Pasa siempre por el controlador (`app_kinesiologia_controlador`, puerto 3023).

## Configuración por entorno

```
config.js                  → defaults base
env/development.js         → defaults dev (committed, sin secretos)
env/production.js          → producción (lee de process.env.*)
env/local.js               → tu config personal (gitignored)
env/local.js.example       → plantilla para clonar a local.js
```

Variables expuestas en `global.config`:
- `app` — puerto y entorno
- `databases[]` — pools mssql
- `security` — jwtSecret, expiraciones, bcryptRounds, bloqueo de login
- `mail` — modo dev/smtp, remitente
- `frontend.baseUrl` — para armar links de invitación
- `invitaciones.expiraHoras` — vigencia del token (RNF-12)

## Scripts útiles

```bash
node scripts/verificar_login.js admin@auris.local 'ChangeMe!2026'
node scripts/generar_hash.js "OtroPassword!2027" correo@x.cl
```

## Base de datos

Todo lo relativo a SQL Server (esquema, dump, instrucciones) vive en [`database/`](./database/). El dump compartido es `database/AurisDB_dump.sql` — idempotente, restaurable de un solo run.

## Ramas

- `master` — código que va a producción.
- `develop` — cambios pendientes de prueba antes de pasar a master.
