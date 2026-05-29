# Backup y Restauración — AurisDB

Procedimiento operacional para el respaldo nocturno de la base de datos y la
restauración ante incidente (Bloque P2.R7 — auditoría ISO 25010).

## SLA declarado

| Métrica | Compromiso | Notas |
|---|---|---|
| Disponibilidad | 99% durante horas hábiles del semestre académico | Lunes a viernes, 08:00–20:00 |
| Frecuencia de backup | Diaria, 03:00 AM (hora local) | Window de bajo tráfico |
| Retención | 14 días (rotación) | 30 días para el último backup mensual |
| RPO (Recovery Point Objective) | **24 horas** | Pérdida máxima aceptada: 1 día |
| RTO (Recovery Time Objective) | **1 hora** | Tiempo máximo de restauración |

## Qué se respalda

| Componente | Tamaño aprox. | Mecanismo |
|---|---|---|
| `AurisDB` (SQL Server) | < 500 MB | SQL Server backup (.bak) |
| GridFS audios + imágenes + videos | < 10 GB | mongodump |
| Configuración (`env/local.js`) | < 5 KB | Copia versionada en gestor de secretos |

## Procedimiento de backup (manual)

### SQL Server — backup completo

Desde SSMS (Tasks → Back Up) o por línea de comandos:

```powershell
sqlcmd -S localhost -U sa -P "TU_PASS" -Q "BACKUP DATABASE AurisDB TO DISK = 'C:\Auris\backups\AurisDB_$(Get-Date -Format yyyyMMdd_HHmmss).bak' WITH COMPRESSION, INIT;"
```

### MongoDB — dump completo de buckets

```bash
mongodump --uri "mongodb://localhost:27017/auris_media" \
          --out "C:\Auris\backups\mongo_$(Get-Date -Format yyyyMMdd_HHmmss)"
```

## Automatización con tarea programada (Windows)

Crea el archivo `C:\Auris\scripts\backup-nocturno.ps1`:

```powershell
# backup-nocturno.ps1 — corre todas las noches a las 03:00 AM
$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = "C:\Auris\backups"

# 1. SQL Server
sqlcmd -S localhost -U sa -P "TU_PASS" -Q `
  "BACKUP DATABASE AurisDB TO DISK = '$backupDir\AurisDB_$timestamp.bak' WITH COMPRESSION, INIT, NAME='AurisDB nightly';"

# 2. MongoDB
mongodump --uri "mongodb://localhost:27017/auris_media" `
          --out "$backupDir\mongo_$timestamp"

# 3. Rotación: borrar backups > 14 días
Get-ChildItem $backupDir -Filter "AurisDB_*.bak" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
    Remove-Item -Force

Get-ChildItem $backupDir -Filter "mongo_*" -Directory |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
    Remove-Item -Recurse -Force

Write-Host "Backup OK: $timestamp"
```

Registra la tarea programada:

```powershell
# Ejecutar como administrador
schtasks /Create /TN "Auris Backup Nocturno" `
         /TR "powershell -ExecutionPolicy Bypass -File C:\Auris\scripts\backup-nocturno.ps1" `
         /SC DAILY /ST 03:00 /RU SYSTEM
```

Verifica que la tarea quedó:

```powershell
schtasks /Query /TN "Auris Backup Nocturno"
```

## Procedimiento de restauración

### Restaurar SQL Server completo (incidente: BD corrupta o accidentalmente DROP'd)

```sql
-- 1. Desconectar usuarios activos
USE master;
ALTER DATABASE AurisDB SET SINGLE_USER WITH ROLLBACK IMMEDIATE;

-- 2. Restaurar desde backup más reciente
RESTORE DATABASE AurisDB
   FROM DISK = 'C:\Auris\backups\AurisDB_20260528_030000.bak'
   WITH REPLACE, RECOVERY;

-- 3. Volver a multi-usuario
ALTER DATABASE AurisDB SET MULTI_USER;
```

### Restaurar MongoDB GridFS

```bash
mongorestore --uri "mongodb://localhost:27017/auris_media" \
             --drop \
             "C:\Auris\backups\mongo_20260528_030000\auris_media"
```

### Verificar tras restauración

```powershell
# Health check del backend
curl http://localhost:2000/readyz

# Conteos en BD
sqlcmd -S localhost -U sa -P "TU_PASS" -d AurisDB -Q `
       "SELECT 'usuarios' AS tabla, COUNT(*) FROM auris.usuario `
        UNION ALL SELECT 'cursos', COUNT(*) FROM auris.curso `
        UNION ALL SELECT 'evaluaciones', COUNT(*) FROM auris.evaluacion;"
```

## Monitoreo

Endpoints expuestos por el backend (Bloque P2.R7):

| Endpoint | Qué verifica | Uso típico |
|---|---|---|
| `GET http://localhost:2000/healthz` | El proceso responde | Liveness probe (k8s, balanceador) |
| `GET http://localhost:2000/readyz` | SQL + Mongo accesibles | Readiness probe — 503 si algo falla |
| `GET http://localhost:2000/health` | Snapshot detallado (latencias, versión) | Dashboard manual |

**Configurar un sondeo cada 30 segundos** en tu herramienta de monitoreo
(UptimeRobot, Cloudflare health checks, Datadog) apuntando a `/readyz` para
detectar caídas dentro del SLA.

## Comprobación periódica de los backups

Una vez al mes, verifica que un backup se restaura sin error en una BD
secundaria (por ejemplo `AurisDB_test_restore`). Si la prueba falla, los
backups no sirven aunque existan en disco.

```sql
RESTORE DATABASE AurisDB_test_restore
   FROM DISK = 'C:\Auris\backups\AurisDB_20260501_030000.bak'
   WITH MOVE 'AurisDB' TO 'C:\TempData\AurisDB_test.mdf',
        MOVE 'AurisDB_log' TO 'C:\TempData\AurisDB_test_log.ldf',
        REPLACE, RECOVERY;

SELECT COUNT(*) FROM AurisDB_test_restore.auris.usuario;

DROP DATABASE AurisDB_test_restore;
```

## Procedimiento ante incidente

1. Detectar (alerta de `/readyz` falla por > 5 minutos).
2. Comunicar a stakeholders por canal predefinido.
3. Si BD: restaurar último backup válido.
4. Si Mongo: restaurar último mongodump.
5. Si infraestructura: reiniciar servicios → SQL Server → Mongo → lógica → controlador → frontend.
6. Verificar con `/health` que todas las latencias estén normales.
7. Documentar postmortem (qué falló, RTO real, lecciones).
