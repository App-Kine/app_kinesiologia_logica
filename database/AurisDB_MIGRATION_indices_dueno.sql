/* ============================================================================
 * Auris — Migración: índices sobre columnas de dueño (2026-06-01)
 * ----------------------------------------------------------------------------
 * Motivo (auditoría de escalabilidad/rendimiento): los listados y las
 * verificaciones de propiedad (RNF-19, anti-IDOR) filtran por el dueño
 * (creado_por / profesor_id) y ordenan por created_at DESC. Sin un índice sobre
 * esas columnas, SQL Server hace un scan completo de la tabla, que se degrada a
 * medida que crecen los datos.
 *
 * Estos índices cubren exactamente esos patrones de consulta:
 *   - test.listarPorProfesor       WHERE activo=1 AND creado_por=@p ORDER BY created_at DESC
 *   - pregunta.listarPorProfesor   WHERE activo=1 AND creado_por=@p ORDER BY created_at DESC
 *   - aplicacion.listarPorProfesor WHERE profesor_id=@p            ORDER BY created_at DESC
 *   - curso (listados por creador)
 *
 * Idempotente: se puede correr varias veces sin error (IF NOT EXISTS).
 * Aplicar con: sqlcmd -d AurisDB -i AurisDB_MIGRATION_indices_dueno.sql
 * ========================================================================== */

USE AurisDB;
GO

/* Tests del profesor: filtro por creado_por (activos) + orden por fecha */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_test_creador_fecha' AND object_id = OBJECT_ID('auris.test'))
    CREATE INDEX IX_test_creador_fecha ON auris.test(creado_por, created_at DESC) WHERE activo = 1;
GO

/* Banco de preguntas del profesor: mismo patrón */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_preg_creador_fecha' AND object_id = OBJECT_ID('auris.pregunta'))
    CREATE INDEX IX_preg_creador_fecha ON auris.pregunta(creado_por, created_at DESC) WHERE activo = 1;
GO

/* Aplicaciones de test por profesor responsable */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_apl_profesor_fecha' AND object_id = OBJECT_ID('auris.aplicacion_test'))
    CREATE INDEX IX_apl_profesor_fecha ON auris.aplicacion_test(profesor_id, created_at DESC);
GO

/* Cursos por creador */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_curso_creador' AND object_id = OBJECT_ID('auris.curso'))
    CREATE INDEX IX_curso_creador ON auris.curso(creado_por) WHERE activo = 1;
GO

PRINT 'Migración de índices de dueño aplicada (idempotente).';
GO
