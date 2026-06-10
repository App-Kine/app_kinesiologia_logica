/* ============================================================================
 * Auris — Migración: enunciado de pregunta a NVARCHAR(MAX) (2026-06-10)
 * ----------------------------------------------------------------------------
 * Motivo (pedido cliente, pruebas de aceptación): el enunciado de una pregunta
 * estaba limitado a NVARCHAR(2000) y los docentes necesitaban superar los 2000
 * caracteres. Se amplía a NVARCHAR(MAX) (el tope efectivo lo pone la app en
 * 10.000 caracteres). explicacion_clinica se mantiene en NVARCHAR(4000).
 *
 * Cambios equivalentes ya aplicados en el código:
 *   - database/AurisDB_INSTALL.sql        → columna enunciado NVARCHAR(MAX)
 *   - database/AurisDB_INSTALL_AZURE.sql  → columna enunciado NVARCHAR(MAX)
 *   - proyecto/services/pregunta.service.js     → validación max 10000
 *   - proyecto/repositories/pregunta.repository.js → NVarChar(MAX) (insert/update)
 *
 * Idempotente: solo altera si la columna NO es ya NVARCHAR(MAX) (max_length=-1).
 *
 * CÓMO APLICARLA
 *   - Azure SQL (despliegue en la nube): conéctate directamente a la base
 *     (p. ej. Auris_2026) y ejecuta este archivo. NO lleva `USE` porque Azure
 *     SQL no permite cambiar de base dentro del script.
 *       sqlcmd -S <servidor>.database.windows.net -d Auris_2026 -U <user> -G -i AurisDB_MIGRATION_enunciado_max.sql
 *   - SQL Server on-prem: selecciona la base antes (o usa -d AurisDB):
 *       sqlcmd -d AurisDB -i AurisDB_MIGRATION_enunciado_max.sql
 * ========================================================================== */

IF EXISTS (
    SELECT 1
    FROM sys.columns  c
    JOIN sys.types    t ON c.user_type_id = t.user_type_id
    WHERE c.object_id = OBJECT_ID(N'auris.pregunta')
      AND c.name      = N'enunciado'
      AND NOT (t.name = N'nvarchar' AND c.max_length = -1)  -- -1 = NVARCHAR(MAX)
)
BEGIN
    ALTER TABLE auris.pregunta ALTER COLUMN enunciado NVARCHAR(MAX) NOT NULL;
    PRINT 'Migración aplicada: auris.pregunta.enunciado -> NVARCHAR(MAX).';
END
ELSE
    PRINT 'Sin cambios: auris.pregunta.enunciado ya es NVARCHAR(MAX).';
GO
