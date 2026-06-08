/* ============================================================================
 * Auris — Migración: índices de RENDIMIENTO (2026-06-03)
 * ----------------------------------------------------------------------------
 * Motivo (auditoría de rendimiento de la capa lógica): hay dos rutas calientes
 * que hoy obligan a SQL Server a leer más de lo necesario:
 *
 *   (a) Analítica / informes por evaluación: las agregaciones y desgloses de
 *       respuesta_pregunta filtran SIEMPRE por evaluacion_id y consultan
 *       resultado, intentos_usados y tiempo_segundos (finalizarEvaluacion,
 *       obtenerDetallePorPregunta, tiempos por evaluación, etc.). Un índice
 *       sobre evaluacion_id con esas columnas como INCLUDE convierte esas
 *       consultas en covering (sin key lookups al heap/clustered).
 *
 *   (b) Login: el control de bloqueo por intentos fallidos cuenta los intentos
 *       recientes de un correo, pero la verificación de "último login exitoso"
 *       y la analítica de accesos miran los intentos EXITOSOS. Un índice
 *       filtrado (WHERE exitoso = 1) ordenado por fecha descendente atiende esa
 *       consulta leyendo solo las filas relevantes (las exitosas suelen ser una
 *       fracción del total de intentos).
 *
 * Nombres de tabla/columna verificados contra database/AurisDB_INSTALL.sql:
 *   - auris.respuesta_pregunta(evaluacion_id, resultado, intentos_usados,
 *                              tiempo_segundos)
 *   - auris.login_intento(correo, ocurrido_en, exitoso)
 *
 * Idempotente: se puede correr varias veces sin error (IF NOT EXISTS).
 * NO ejecutar como parte del dump: lo aplica infraestructura por separado con:
 *   sqlcmd -d AurisDB -i AurisDB_MIGRATION_indices_rendimiento.sql
 * ========================================================================== */

USE AurisDB;
GO

/* (a) Respuestas por evaluación: filtro por evaluacion_id + columnas de
 *     agregación/informe como INCLUDE → índice covering para analítica e
 *     informes (finalizarEvaluacion, detalle/tiempos por evaluación). */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_resp_eval_resultado' AND object_id = OBJECT_ID('auris.respuesta_pregunta'))
    CREATE INDEX IX_resp_eval_resultado
        ON auris.respuesta_pregunta(evaluacion_id)
        INCLUDE (resultado, intentos_usados, tiempo_segundos);
GO

/* (b) Intentos de login EXITOSOS por correo, más recientes primero. Índice
 *     filtrado: solo indexa las filas con exitoso = 1 (las que importan para
 *     "último acceso correcto" y analítica de accesos), manteniéndolo pequeño. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_li_correo_exito' AND object_id = OBJECT_ID('auris.login_intento'))
    CREATE INDEX IX_li_correo_exito
        ON auris.login_intento(correo, ocurrido_en DESC)
        WHERE exitoso = 1;
GO

PRINT 'Migración de índices de rendimiento aplicada (idempotente).';
GO
