# Setup completo de Auris — paso a paso

> Esta guía levanta el sistema completo en una máquina nueva. Si haces los pasos en orden y copias los comandos tal cual, debería funcionar de una.

## 0. Qué vas a instalar

Auris son **4 repos** que se comunican entre sí:

| # | Repo | Qué es | Puerto |
|---|------|--------|--------|
| 1 | `app_kinesiologia_logica` | Backend Node (acceso a BD + Mongo) | `2000` |
| 2 | `app_kinesiologia_controlador` | Backend Node (proxy + JWT + entrada pública) | `3023` |
| 3 | `app_kinesiologia_panel` | Web Ionic/Angular para docentes y admin | `4200` |
| 4 | `app_kinesiologia_frontend` | App móvil Ionic/Angular para estudiantes | `4201` |

Más dos servicios de datos:

- **SQL Server** (puerto `1433`) — datos relacionales.
- **MongoDB** (puerto `27017`) — audios, imágenes y videos de las preguntas.

Cómo se hablan:

```
[panel :4200]  [frontend :4201]
       \           /
        ↓ HTTP    ↓ HTTP
     [controlador :3023]
              ↓ HTTP
         [lógica :2000] ──→ SQL Server :1433
                       └──→ MongoDB :27017
```

---

## 1. Prerrequisitos

Instala estos antes de empezar:

| Software | Versión | Dónde |
|---|---|---|
| **Node.js** | **20.19.0** (NO 22+) | https://nodejs.org → buscar v20.19.0 |
| **Git** | última | https://git-scm.com |
| **SQL Server** | 2019 o 2022, Express o Developer | https://www.microsoft.com/sql-server/sql-server-downloads |
| **SSMS** (SQL Server Management Studio) | última | https://learn.microsoft.com/sql/ssms/download-sql-server-management-studio-ssms |
| **MongoDB Community** | 7.x | https://www.mongodb.com/try/download/community |
| **mongosh** | última | viene con el instalador de MongoDB, o https://www.mongodb.com/try/download/shell |

> **¿Por qué Node 20.19.0 y no 22?** Capacitor 7 (que usa el frontend móvil) no es compatible con Node 22. Si ya tienes Node 22 instalado, usa **nvm-windows** para instalar la 20.19.0 sin desinstalar lo otro.

Verifica que todo quedó instalado:

```powershell
node --version    # debe decir v20.19.0
npm --version
git --version
mongosh --version
```

Para SQL Server: abre SSMS y conéctate con `localhost` (o `localhost\SQLEXPRESS` si instalaste Express). Debes poder loguearte como `sa`.

> **Importante con SQL Server Express**: durante la instalación elige **Mixed Mode Authentication** y define una password para el usuario `sa`. Esa password la vas a usar en `env/local.js`.

---

## 2. Clonar los 4 repos

Crea una carpeta `Auris/` y clona dentro:

```powershell
mkdir Auris
cd Auris

git clone <URL_logica>       app_kinesiologia_logica
git clone <URL_controlador>  app_kinesiologia_controlador
git clone <URL_panel>        app_kinesiologia_panel
git clone <URL_frontend>     app_kinesiologia_frontend
```

> Reemplaza `<URL_xxx>` por las URLs reales de los repos. Estructura final:

```
Auris/
├── app_kinesiologia_logica/
├── app_kinesiologia_controlador/
├── app_kinesiologia_panel/
└── app_kinesiologia_frontend/
```

---

## 3. Aplicar la base de datos

**Hay UN SOLO archivo que hace todo:** `app_kinesiologia_logica/database/AurisDB_INSTALL.sql`.

Crea la BD `AurisDB`, las 16 tablas, índices, vistas, triggers, los 6 usuarios de demo, 3 cursos, 6 preguntas con sus alternativas, 2 tests y 2 aplicaciones activas. Listo para usar de inmediato.

### Cómo aplicarlo (SSMS, lo más fácil)

1. Abre **SQL Server Management Studio**.
2. Conéctate al servidor (`localhost` o `localhost\SQLEXPRESS`) como `sa`.
3. **File → Open → File…** → selecciona `app_kinesiologia_logica\database\AurisDB_INSTALL.sql`.
4. Presiona **F5** para ejecutar.

Al final debes ver en la pestaña Messages:

```
Instalación completa. Conteos por tabla:
  curso              3
  pregunta           6
  test               2
  aplicacion_test    2
  ...
Listo. El sistema está usable:
  - Panel (http://localhost:4200) → login con cualquier usuario.
  - App estudiante (http://localhost:4201) → ver 3 cursos, 2 tests.
```

### Alternativa: línea de comandos

```powershell
sqlcmd -S localhost -U sa -P "TU_PASS" -C `
       -i "app_kinesiologia_logica\database\AurisDB_INSTALL.sql"
```

### Verificar (opcional, en una query nueva)

```sql
USE AurisDB;
SELECT correo, STRING_AGG(r.codigo, ', ') AS roles
FROM auris.usuario u
JOIN auris.usuario_rol ur ON ur.usuario_id = u.usuario_id
JOIN auris.rol r ON r.rol_id = ur.rol_id
GROUP BY correo ORDER BY correo;
```

Debes ver 6 usuarios (admin, superadmin, maría, juan, ana, carlos).

---

## 4. Inicializar los buckets de MongoDB

Asegúrate que MongoDB está corriendo. Si lo instalaste como servicio de Windows, ya arrancó solo. Verifica:

```powershell
mongosh "mongodb://localhost:27017" --eval "db.runCommand({ ping: 1 })"
# debe responder { ok: 1 }
```

Luego corre el script de inicialización (desde la carpeta `app_kinesiologia_logica`):

```powershell
cd app_kinesiologia_logica
mongosh "mongodb://localhost:27017/auris_media" database\mongodb\init_mongo.js
```

Debe terminar con:

```
MongoDB GridFS inicializado: fs_audios, fs_imagenes y fs_videos listos en auris_media.
```

---

## 5. Configurar `env/local.js` en la lógica

La lógica necesita saber la password de SQL Server y opcionalmente las credenciales SMTP.

```powershell
cd app_kinesiologia_logica
copy env\local.js.example env\local.js
```

Abre `env\local.js` en tu editor y ajusta:

```js
localDatabases: [
    {
        code: "auris",
        server: "localhost",                  // o "localhost\\SQLEXPRESS" si usas Express
        port: 1433,
        user: "sa",
        password: "TU_PASSWORD_DE_SQL_AQUI",  // ⬅️ la que definiste al instalar SQL Server
        database: "AurisDB",
        ...
    },
],
```

> Si usaste **SQL Server Express** con instancia nombrada, normalmente no tienes que cambiar `port`, pero sí poner el server como `"localhost\\SQLEXPRESS"` (las dos `\\` son intencionales — JavaScript necesita escapar la barra).

**SMTP (opcional, solo si quieres recibir correos de invitación / reset de password):**

```js
mail: {
    mode: "smtp",
    from: "AURIS <tu.cuenta@gmail.com>",
    smtp: {
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        user: "tu.cuenta@gmail.com",
        password: "xxxxxxxxxxxxxxxx",   // App Password de Gmail (16 chars sin espacios)
    },
},
```

Para generar un App Password de Gmail: cuenta Google → Seguridad → Verificación en 2 pasos → Contraseñas de aplicación.

Si dejas `mode: "dev"`, los correos se imprimen en la consola en lugar de enviarse.

> El campo `mongo.uri` ya viene apuntando a `localhost:27017` que es lo que acabamos de levantar — no tienes que tocarlo.

---

## 6. `npm install` en los 4 repos

Esto puede tardar varios minutos la primera vez. Desde la carpeta `Auris/`:

```powershell
cd app_kinesiologia_logica         ; npm install ; cd ..
cd app_kinesiologia_controlador    ; npm install ; cd ..
cd app_kinesiologia_panel          ; npm install ; cd ..
cd app_kinesiologia_frontend       ; npm install --legacy-peer-deps ; cd ..
```

> El `--legacy-peer-deps` del frontend móvil es porque Capacitor 7 + Cordova legacy tienen un conflicto menor de rxjs.

---

## 7. Arrancar los 4 servicios

Necesitas **4 terminales**, una por cada repo. **El orden importa**: primero lógica, después controlador, después los frontends.

### Terminal 1 — Lógica (puerto 2000)

```powershell
cd app_kinesiologia_logica
npm run dev
```

Debe terminar con:

```
[db] Pool "auris" → localhost:1433/AurisDB listo
[mongo] Conectado a auris_media (fs_audios, fs_imagenes, fs_videos)
Servidor escuchando en puerto 2000
```

### Terminal 2 — Controlador (puerto 3023)

```powershell
cd app_kinesiologia_controlador
npm run dev
```

Espera a ver:

```
Servidor escuchando en puerto 3023
```

### Terminal 3 — Panel web (puerto 4200, para docentes/admin)

```powershell
cd app_kinesiologia_panel
npm start
```

Abre solo cuando veas `✔ Compiled successfully` y `Local: http://localhost:4200`.

### Terminal 4 — App móvil (puerto 4201, para estudiantes)

```powershell
cd app_kinesiologia_frontend
npm start
```

Abre cuando veas `Local: http://localhost:4201`.

---

## 8. Probar el sistema

### Como docente / admin

Entra a **http://localhost:4200** y prueba con cualquiera de estos usuarios:

| Correo | Password | Te lleva a |
|---|---|---|
| `admin@auris.local` | `ChangeMe!2026` | Pantalla de selección (admin + docente) |
| `superadmin@auris.local` | `AdminPuro!2026` | Panel admin (invitar profesores) |
| `maria.gonzalez@auris.local` | `ChangeMe!2026` | Panel docente |
| `juan.perez@auris.local` | `ChangeMe!2026` | Panel docente |
| `ana.rodriguez@auris.local` | `ChangeMe!2026` | Panel docente |

Como docente deberías ver tus cursos asignados, tests, aplicaciones y analítica.

### Como estudiante

Entra a **http://localhost:4201** (sin login). Debes ver:

1. Home con 2 botones: **Auscultación 3D** y **Tests**.
2. **Auscultación** → modelo 3D del torso con hotspots clickeables.
3. **Tests** → lista de 3 cursos (KINE-401, KINE-402, KINE-501).
4. Eligiendo KINE-401 → test "Ruidos pulmonares básicos" (4 preguntas).
5. Eligiendo KINE-501 → test "Soplos cardíacos y focos auscultatorios" (2 preguntas).
6. Puedes hacer el test en modo anónimo o identificado.

---

## 9. Comandos del día a día

### Encender / apagar

- SQL Server y MongoDB se levantan solos al arrancar Windows (corren como servicios). Si quieres apagarlos manualmente: **services.msc** → busca `SQL Server (MSSQLSERVER)` y `MongoDB` → click derecho → Stop.
- Para los 4 servicios Node: Ctrl+C en cada terminal.

### Re-aplicar el setup cuando algo falla

`AurisDB_INSTALL.sql` es idempotente (todos los INSERTs usan `IF NOT EXISTS`). Puedes correrlo todas las veces que quieras: si la BD ya tiene los datos, no los duplica.

### Volver a un estado limpio desde cero

En SSMS:

```sql
USE master;
DROP DATABASE AurisDB;
```

Luego vuelve a abrir `AurisDB_INSTALL.sql` y F5.

### Empezar de cero con la BD

En SSMS:

```sql
DROP DATABASE AurisDB;
```

Luego repite el paso 3 (aplicar los 2 SQL).

---

## 10. Si algo sale mal

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Login failed for user 'sa'` | Password incorrecta o SA deshabilitado | Verifica que `env/local.js` tenga la misma password de SQL Server. Para habilitar SA: SSMS → Security → Logins → sa → Properties → Status → Login: Enabled |
| `Cannot open database 'AurisDB'` | El dump no se aplicó | Repite el paso 3 |
| `DB pool no inicializado para code="auris"` | La lógica arrancó antes que SQL Server estuviera listo | Apaga la lógica y reinicia |
| `[mongo] no disponible` al subir archivos | MongoDB no está corriendo | services.msc → MongoDB → Start |
| `Bucket fs_videos no disponible` | No corriste init_mongo.js | Repite el paso 4 |
| El frontend no llega al backend (CORS, 404) | El controlador no está corriendo | Verifica terminal 2 (puerto 3023) |
| `Capacitor CLI requires NodeJS >=22.0.0` | Estás en Node 22+ | Cambia a Node 20.19.0 con nvm-windows |
| `ERESOLVE rxjs` al instalar el frontend móvil | Conflicto Cordova legacy | Agrega `--legacy-peer-deps` |
| Port 1433 ya en uso | Otra instancia de SQL Server | Apaga la otra o cambia el puerto en `env/local.js` |
| Port 4200/4201 ya en uso | Otro Angular corriendo | `npm start -- --port 4300` (o el que quieras) |
| El estudiante no ve cursos | El reseed no corrió | Repite el segundo SQL del paso 3 |
| SSMS no se conecta a `localhost` | Servicio SQL Server detenido | services.msc → SQL Server (MSSQLSERVER) → Start |
| Error `TLS handshake` con SQL Server | Express usa TLS estricto | En `env/local.js` deja `encrypt: true, trustServerCertificate: true` |

---

## 11. Archivos clave (referencia rápida)

| Archivo | Para qué |
|---|---|
| `app_kinesiologia_logica/env/local.js` | Credenciales de BD + SMTP + Mongo (NO se sube a git) |
| `app_kinesiologia_logica/env/local.js.example` | Plantilla |
| **`app_kinesiologia_logica/database/AurisDB_INSTALL.sql`** | **Instalación completa de la BD en un solo archivo (el que vas a usar)** |
| `app_kinesiologia_logica/database/mongodb/init_mongo.js` | Crea buckets GridFS |
| `app_kinesiologia_logica/database/SETUP.md` | Setup detallado de BD con Docker (alternativa para Mac) |
| `app_kinesiologia_logica/database/mongodb/SETUP_MONGO.md` | Setup detallado de Mongo |
| `app_kinesiologia_logica/database/PROD_db_user.sql` | (producción) Usuario de BD con privilegios mínimos |
| `app_kinesiologia_logica/database/PROD_superadmin.sql` | (producción) Seed del superadmin con clave fuerte |

---

## 12. Resumen ultra-corto (TL;DR)

Una vez que tienes **SQL Server**, **MongoDB**, **Node 20.19.0**, **mongosh** y **SSMS** instalados:

```powershell
# 1) Clonar
mkdir Auris ; cd Auris
git clone <URL_logica>       app_kinesiologia_logica
git clone <URL_controlador>  app_kinesiologia_controlador
git clone <URL_panel>        app_kinesiologia_panel
git clone <URL_frontend>     app_kinesiologia_frontend

# 2) BD: abrir en SSMS y darle F5 a:
#    app_kinesiologia_logica\database\AurisDB_INSTALL.sql

# 3) Mongo
cd app_kinesiologia_logica
mongosh "mongodb://localhost:27017/auris_media" database\mongodb\init_mongo.js

# 4) Config
copy env\local.js.example env\local.js
# editar env\local.js y poner tu password de SQL Server

# 5) Instalar dependencias
npm install ; cd ..
cd app_kinesiologia_controlador    ; npm install ; cd ..
cd app_kinesiologia_panel          ; npm install ; cd ..
cd app_kinesiologia_frontend       ; npm install --legacy-peer-deps ; cd ..

# 6) Arrancar (4 terminales, en este orden)
cd app_kinesiologia_logica       ; npm run dev
cd app_kinesiologia_controlador  ; npm run dev
cd app_kinesiologia_panel        ; npm start
cd app_kinesiologia_frontend     ; npm start

# 7) Abrir
# http://localhost:4200  (panel docente/admin)
# http://localhost:4201  (app estudiante)
```
