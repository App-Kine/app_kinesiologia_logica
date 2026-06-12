/* ============================================================================
 * Auris — Migración: orden manual de aplicaciones por curso (2026-06-11)
 * ----------------------------------------------------------------------------
 * Motivo (pedido cliente): poder dejar los tests de cada curso en un orden
 * definido (ej. "Nivel 1", "Nivel 2", "Nivel 3"). Se agrega la columna
 * auris.aplicacion_test.orden (INT NULL):
 *   - NULL  → el test no fue reordenado a mano; la app lo ubica por nombre
 *             (orden natural: "Nivel 1, 2, … 10").
 *   - 1..N  → orden manual fijado por el profesor (arrastrando en el curso).
 *
 * Cambios equivalentes ya aplicados en el código:
 *   - database/AurisDB_INSTALL.sql / _AZURE.sql → columna `orden INT NULL`
 *   - lógica: nuevo endpoint reordenarAplicaciones + `orden` en los listados
 *   - controlador: ruta reordenarAplicaciones (rol PROFESOR)
 *   - frontend: orden natural por nombre + reordenar arrastrando (curso-detalle)
 *
 * Idempotente: solo agrega la columna si no existe.
 *
 * CÓMO APLICARLA
 *   - Azure SQL: conéctate a la base (p. ej. Auris_2026) y ejecuta este archivo
 *     (no lleva `USE`, Azure no lo permite dentro del script).
 *       sqlcmd -S <servidor>.database.windows.net -d Auris_2026 -U <user> -G -i AurisDB_MIGRATION_aplicacion_orden.sql
 *   - SQL Server on-prem:
 *       sqlcmd -d AurisDB -i AurisDB_MIGRATION_aplicacion_orden.sql
 * ========================================================================== */

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'auris.aplicacion_test')
      AND name = N'orden'
)
BEGIN
    ALTER TABLE auris.aplicacion_test ADD orden INT NULL;
    PRINT 'Migración aplicada: auris.aplicacion_test.orden agregada (INT NULL).';
END
ELSE
    PRINT 'Sin cambios: auris.aplicacion_test.orden ya existe.';
GO
