/* =============================================================================
   Migración 2026-05-26
   Pedido de cliente:
     1) Rich text en enunciado/explicación  → ya cabe en NVARCHAR(2000/4000),
        no requiere cambio de schema. El frontend almacena HTML sanitizado.
     2) Tiempo por pregunta                  → respuesta_pregunta.tiempo_segundos
     3) Informe descargable                  → solo cambios en backend/front
     4) Video en preguntas (MP4 ≤ 50 MB)    → pregunta.video_grid_id
   ============================================================================= */

USE AurisDB;
GO

/* ---------- 1) pregunta.video_grid_id (GridFS ObjectId hex 24) ---------- */
IF COL_LENGTH('auris.pregunta', 'video_grid_id') IS NULL
BEGIN
    ALTER TABLE auris.pregunta
        ADD video_grid_id VARCHAR(24) NULL
            CONSTRAINT CK_preg_gridid_video CHECK (video_grid_id IS NULL OR LEN(video_grid_id) = 24);
END
GO

/* ---------- 2) respuesta_pregunta.tiempo_segundos ----------
   Tiempo (en segundos) que el estudiante se quedó EN la pregunta antes de
   confirmar la respuesta del intento que la dejó FINALIZADA (acierto en 1°
   intento, acierto en 2° intento, o incorrecta tras 2 intentos). NULL para
   filas que aún están en intento 1 incorrecto y van a recibir un intento 2.
*/
IF COL_LENGTH('auris.respuesta_pregunta', 'tiempo_segundos') IS NULL
BEGIN
    ALTER TABLE auris.respuesta_pregunta
        ADD tiempo_segundos INT NULL
            CONSTRAINT CK_resp_tiempo CHECK (tiempo_segundos IS NULL OR tiempo_segundos >= 0);
END
GO

PRINT 'OK: video_grid_id y tiempo_segundos agregados.';
GO
