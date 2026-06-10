# Setup de la base de datos AurisDB

Crea la base de datos **AurisDB** en SQL Server y los buckets de **MongoDB**
ejecutando los scripts de instalación. **No requiere Docker** — se usa la
instancia de SQL Server / MongoDB que ya tengas (o una instalación nativa).

## Requisitos

- **SQL Server 2019+** (o Azure SQL) accesible.
- **MongoDB 6+** (almacena la multimedia de las preguntas: audios/imágenes/videos).
- Una herramienta para ejecutar SQL: **SSMS**, **Azure Data Studio** o **sqlcmd**.
- **Node.js ≥ 18** (para inicializar Mongo y, en producción, generar el hash del superadmin).

---

## 0. Clonar los repositorios

Auris son **3 repos** (el código definitivo está en la rama **`unification`**). Clónalos en **una misma carpeta** (carpetas hermanas):

```bash
git clone -b unification https://github.com/App-Kine/app_kinesiologia_logica.git
git clone -b unification https://github.com/App-Kine/app_kinesiologia_controlador.git
git clone -b unification https://github.com/App-Kine/app_kinesiologia_frontend.git
```

```
mi-carpeta/
├── app_kinesiologia_logica/        # backend: BD + negocio + multimedia + correo  (ESTE repo)
├── app_kinesiologia_controlador/   # gateway / API           (:3023)
└── app_kinesiologia_frontend/      # app unificada estudiante + panel docente  (:4201)
```

### 📋 Resumen — qué archivos CREAR y qué CAMBIAR
| Dónde | Acción | Detalle |
|---|---|---|
| `app_kinesiologia_logica/env/local.js` | **CREAR** `cp env/local.js.example env/local.js` | **Cambiar la `password` de SQL Server** (obligatorio). Opcional: `jwtSecret`, bloque `smtp` para enviar correos reales. |
| `app_kinesiologia_controlador/env/local.js` | **CREAR** `cp env/local.js.example env/local.js` | El `jwtSecret` **debe ser idéntico** al de la lógica. Con los defaults ya coinciden → no hay que tocar nada. |
| **SQL Server** | **EJECUTAR** `AurisDB_INSTALL.sql` | Crea la BD `AurisDB` + esquema + datos de demo (paso 1). |
| **MongoDB** | **EJECUTAR** `mongosh ".../auris_media" database/mongodb/init_mongo.js` | Crea los buckets de multimedia (paso 2). |
| `app_kinesiologia_frontend` *(solo si pruebas en un celular físico)* | **CAMBIAR** host | `npm run ios` / `npm run android` ponen la IP del Mac **solos**; en web/simulador queda `localhost`. |

> En resumen: lo **único obligatorio** de editar a mano es la **password de SQL Server** en `app_kinesiologia_logica/env/local.js`. Todo lo demás funciona con los valores por defecto en local.

---

## 1. Crear la base de datos (SQL Server)

Conéctate a tu instancia de SQL Server y ejecuta el script canónico
[`AurisDB_INSTALL.sql`](AurisDB_INSTALL.sql). Es **idempotente** (puedes correrlo
varias veces sin duplicar) y crea el esquema `auris`, tablas, índices, vistas y
los datos de demo.

**Opción A — SSMS / Azure Data Studio (recomendado en Windows):**
`File → Open File → AurisDB_INSTALL.sql → Execute (F5)`.

**Opción B — sqlcmd (línea de comandos):**
```bash
sqlcmd -S <host> -U sa -P "<password>" -C -i AurisDB_INSTALL.sql
```
(reemplaza `<host>` por `localhost` o el servidor, y `<password>` por la de tu `sa`).

Al final verás el listado de tablas/vistas y los conteos de filas.

---

## 2. Inicializar MongoDB (multimedia)

Crea los buckets GridFS ejecutando el script con **`mongosh`** (viene incluido con MongoDB):

```bash
cd app_kinesiologia_logica
mongosh "mongodb://localhost:27017/auris_media" database/mongodb/init_mongo.js
```
(si usas Atlas u otra instancia, reemplaza la URI manteniendo `/auris_media` al final).
Crea los buckets `fs_audios`, `fs_imagenes`, `fs_videos` con índices y validadores.
Es **idempotente**. Ver detalle en [`mongodb/SETUP_MONGO.md`](mongodb/SETUP_MONGO.md).

---

## 3. Verificar

Con SSMS / Azure Data Studio / sqlcmd:
```sql
SELECT correo, STRING_AGG(r.codigo, ', ') AS roles
FROM auris.usuario u
JOIN auris.usuario_rol ur ON ur.usuario_id = u.usuario_id
JOIN auris.rol r ON r.rol_id = ur.rol_id
GROUP BY correo ORDER BY correo;
```

Deberías ver 3 usuarios:

| correo | roles |
|---|---|
| admin@auris.local | PROFESOR, SUPERADMIN |
| juan.perez@auris.local | PROFESOR |
| superadmin@auris.local | SUPERADMIN |

## 4. Credenciales de demo

| Usuario | Password | Rol(es) | Te lleva a |
|---|---|---|---|
| `admin@auris.local` | `ChangeMe!2026` | SUPERADMIN + PROFESOR | Pantalla de selección |
| `superadmin@auris.local` | `ChangeMe!2026` | SUPERADMIN | Panel administración |
| `juan.perez@auris.local` | `ChangeMe!2026` | PROFESOR | Panel docente |

---

## 5. Configurar y arrancar los backends

**Lógica:**
```bash
cd app_kinesiologia_logica
npm install
cp env/local.js.example env/local.js
# Edita env/local.js: pon la password de SQL Server, el JWT_SECRET y (opcional) SMTP.
npm run dev-unix      # Windows: npm run dev
```

**Controlador (otra terminal):**
```bash
cd app_kinesiologia_controlador
npm install
cp env/local.js.example env/local.js
# ⚠️ El jwtSecret de este local.js DEBE ser EXACTAMENTE el mismo que el de la
#    lógica. Con los defaults ya coinciden; si cambiaste el de la lógica, cámbialo aquí también.
npm run dev-unix      # Windows: npm run dev
```

**App Auris — estudiante + panel docente (otra terminal):**
```bash
cd app_kinesiologia_frontend
npm install           # trae .npmrc (legacy-peer-deps), npm install funciona directo
npm start             # http://localhost:4201
```
> Es **una sola app**: al abrir `http://localhost:4201` aparece una landing →
> **"Soy estudiante"** (público) o **"Soy profesor"** (login con las credenciales
> de demo de arriba). El panel docente ya está incluido aquí (no hay repo aparte).

---

## Para PRODUCCIÓN (sin datos de demo)

1. Ejecutar el esquema con `AurisDB_INSTALL.sql` (o solo la parte del esquema).
2. Crear el usuario de aplicación con permisos mínimos: [`PROD_db_user.sql`](PROD_db_user.sql).
3. Definir el superadmin de producción con contraseña fuerte. **Lo más simple:**
   entrar al panel con el `admin@auris.local` que crea el instalador y **cambiar
   su contraseña (y correo) desde la app** — la app hashea sola, sin scripts.
   Alternativa solo-SQL: [`PROD_superadmin.sql`](PROD_superadmin.sql).
4. Aplicar los índices de rendimiento: [`AurisDB_MIGRATION_indices_dueno.sql`](AurisDB_MIGRATION_indices_dueno.sql).
5. **Solo si la BD ya existía de antes** (no en instalaciones nuevas, que ya traen
   el tipo correcto): ampliar el enunciado a `NVARCHAR(MAX)` con
   [`AurisDB_MIGRATION_enunciado_max.sql`](AurisDB_MIGRATION_enunciado_max.sql).
   Es idempotente y Azure-safe (no usa `USE`).
6. Configurar los backends por variables de entorno (ver `.env.example`), nunca con secretos en archivos versionados.

Respaldo y restauración: [`BACKUP.md`](BACKUP.md).

---

## Si algo sale mal

| Síntoma | Solución |
|---|---|
| `Login failed for user 'sa'` | Password incorrecta. Revisa la de `env/local.js` y la de tu SQL Server. |
| `Cannot open database 'AurisDB'` | El script no se aplicó. Repite el paso 1. |
| `Port 1433 ya en uso` | Otra instancia de SQL Server. Usa el puerto correcto y actualiza `env/local.js`. |

> **Nota (solo desarrollo local en Mac Apple Silicon):** si no tienes SQL Server
> nativo, puedes levantar uno con Docker usando la imagen `azure-sql-edge`
> (ARM). Esto es **opcional y solo para el equipo de desarrollo** — el entorno
> productivo usa la instancia de SQL Server institucional, sin Docker.
