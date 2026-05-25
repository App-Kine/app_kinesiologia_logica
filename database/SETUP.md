# Setup de la base de datos AurisDB (para nuevos colaboradores)

Esta guía levanta SQL Server en tu máquina y restaura el dump compartido.

## Requisitos

- Docker Desktop instalado y corriendo.
- (Recomendado) Azure Data Studio para inspeccionar la BD con GUI.

---

## 1. Levantar SQL Server en Docker

> En Mac con chip Apple Silicon (M1/M2/M3/M4) usamos **Azure SQL Edge** porque tiene imagen ARM nativa.
> En Mac Intel / Linux / Windows también funciona la misma imagen.

```bash
docker run -e "ACCEPT_EULA=Y" \
           -e "MSSQL_SA_PASSWORD=TuPasswordSegura!2026" \
           -p 1433:1433 \
           --name sqlserver \
           -v sqlserver-data:/var/opt/mssql \
           -d mcr.microsoft.com/azure-sql-edge:latest
```

> El password debe cumplir la política de SQL Server: ≥8 chars, mayús, minús, dígito y símbolo. Anota el que pongas, lo usarás en `env/local.js`.

Verifica que arrancó (espera unos 15-20 segundos la primera vez):

```bash
sleep 15 && docker logs sqlserver | tail -10
# debe terminar con: "SQL Server is now ready for client connections"
```

## 2. Restaurar el dump

Desde la carpeta del repo de la lógica:

```bash
cd app_kinesiologia_logica

# Copiar el dump dentro del contenedor
docker cp database/AurisDB_dump.sql sqlserver:/tmp/AurisDB_dump.sql

# Ejecutarlo con un contenedor sidecar que trae sqlcmd
docker run --rm \
    --network container:sqlserver \
    -v "$PWD/database":/scripts \
    mcr.microsoft.com/mssql-tools \
    /opt/mssql-tools/bin/sqlcmd \
    -S localhost,1433 -U sa -P 'TuPasswordSegura!2026' -C \
    -i /scripts/AurisDB_dump.sql
```

La primera vez Docker descarga la imagen `mssql-tools` (~150 MB).

Al final deberías ver el listado de las 16 tablas, las 2 vistas y los conteos de datos.

## 3. Verificar conexión

```bash
docker run --rm \
    --network container:sqlserver \
    mcr.microsoft.com/mssql-tools \
    /opt/mssql-tools/bin/sqlcmd \
    -S localhost,1433 -U sa -P 'TuPasswordSegura!2026' -C -d AurisDB \
    -Q "SELECT correo, STRING_AGG(r.codigo, ', ') AS roles
        FROM auris.usuario u
        JOIN auris.usuario_rol ur ON ur.usuario_id = u.usuario_id
        JOIN auris.rol r ON r.rol_id = ur.rol_id
        GROUP BY correo ORDER BY correo;"
```

Deberías ver 6 usuarios:

| correo | roles |
|---|---|
| admin@auris.local | PROFESOR, SUPERADMIN |
| ana.rodriguez@auris.local | PROFESOR |
| carlos.munoz@auris.local | PROFESOR |
| juan.perez@auris.local | PROFESOR |
| maria.gonzalez@auris.local | PROFESOR |
| superadmin@auris.local | SUPERADMIN |

## 4. Credenciales de demo

Todos los usuarios excepto `superadmin@auris.local` tienen la misma password de demo:

| Usuario | Password | Rol(es) | Te lleva a |
|---|---|---|---|
| `admin@auris.local` | `ChangeMe!2026` | SUPERADMIN + PROFESOR | Pantalla de selección |
| `superadmin@auris.local` | `AdminPuro!2026` | SUPERADMIN | Panel administración |
| `maria.gonzalez@auris.local` | `ChangeMe!2026` | PROFESOR | Panel docente |
| `juan.perez@auris.local` | `ChangeMe!2026` | PROFESOR | Panel docente |
| `ana.rodriguez@auris.local` | `ChangeMe!2026` | PROFESOR | Panel docente |
| `carlos.munoz@auris.local` | `ChangeMe!2026` | PROFESOR | Panel docente |

## 5. Configurar los backends

Después de restaurar la BD, configura los dos backends Node:

**Lógica:**
```bash
cd app_kinesiologia_logica
npm install
cp env/local.js.example env/local.js
# Edita env/local.js y pon en `password` la misma password de SQL Server que usaste arriba
npm run dev-unix
```

**Controlador (otra terminal):**
```bash
cd app_kinesiologia_controlador
npm install
cp env/local.js.example env/local.js   # opcional, defaults funcionan
npm run dev-unix
```

**Frontend (otra terminal):**
```bash
cd app_kinesiologia_frontend
npm install
npm start
# se abre en http://localhost:4200
```

## Comandos útiles del contenedor

```bash
docker stop sqlserver           # apagar
docker start sqlserver          # encender
docker logs sqlserver | tail    # ver logs
docker rm -f sqlserver          # borrar (los datos persisten en el volumen sqlserver-data)
docker volume rm sqlserver-data # borrar TAMBIÉN los datos (volverías a empezar de cero)
```

## Si algo sale mal

| Síntoma | Solución |
|---|---|
| `Login failed for user 'sa'` | Password incorrecta. Revísala en env/local.js y en el `MSSQL_SA_PASSWORD` del contenedor. |
| `Cannot open database 'AurisDB'` | El dump no se aplicó. Ejecuta el paso 2 de nuevo. |
| El contenedor se cierra solo en Mac M-series | Usa `azure-sql-edge` en vez de `mssql/server`. |
| Port 1433 ya en uso | Otro SQL Server local. Apaga el otro o usa `-p 1434:1433` y actualiza `env/local.js`. |
