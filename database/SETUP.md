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

Crea los buckets GridFS ejecutando el script de inicialización con Node:

```bash
cd app_kinesiologia_logica
node database/mongodb/init_mongo.js
```
(usa la conexión de `env/local.js` o las variables `MONGO_URI` / `MONGO_DB`).
Ver detalle en [`mongodb/SETUP_MONGO.md`](mongodb/SETUP_MONGO.md).

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
cp env/local.js.example env/local.js   # los defaults funcionan en local
npm run dev-unix      # Windows: npm run dev
```

**Panel web (otra terminal):**
```bash
cd app_kinesiologia_panel
npm install
npm start             # http://localhost:4200
```

**App del estudiante (otra terminal):**
```bash
cd app_kinesiologia_frontend
npm install
npm start             # http://localhost:4201
```

---

## Para PRODUCCIÓN (sin datos de demo)

1. Ejecutar el esquema con `AurisDB_INSTALL.sql` (o solo la parte del esquema).
2. Crear el usuario de aplicación con permisos mínimos: [`PROD_db_user.sql`](PROD_db_user.sql).
3. Definir el superadmin de producción con contraseña fuerte. **Lo más simple:**
   entrar al panel con el `admin@auris.local` que crea el instalador y **cambiar
   su contraseña (y correo) desde la app** — la app hashea sola, sin scripts.
   Alternativa solo-SQL: [`PROD_superadmin.sql`](PROD_superadmin.sql).
4. Aplicar los índices de rendimiento: [`AurisDB_MIGRATION_indices_dueno.sql`](AurisDB_MIGRATION_indices_dueno.sql).
5. Configurar los backends por variables de entorno (ver `.env.example`), nunca con secretos en archivos versionados.

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
