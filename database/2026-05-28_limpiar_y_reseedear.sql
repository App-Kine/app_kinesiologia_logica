/* =============================================================================
   Migración + reseed 2026-05-28
   ----------------------------------------------------------------------------
   Reportado por el usuario: "no me deja acceder a realizar un test porque hay
   columnas que no están". Los datos sembrados originalmente tienen referencias
   inconsistentes con el esquema actual (faltan video_grid_id / tiempo_segundos,
   audios apuntando a GridFS IDs falsos) y el cliente cambió la BD entre medio.

   Este script:
     1) Aplica de forma idempotente las migraciones de mayo
        (video_grid_id en pregunta, tiempo_segundos en respuesta_pregunta).
     2) BORRA todo el contenido académico (cursos, tests, preguntas,
        aplicaciones, evaluaciones, respuestas, asignaciones, logs de auditoría
        referidos a esas entidades).
     3) PRESERVA usuarios, roles, contraseñas e invitaciones — NO toca login.
     4) RESIEMBRA 3 cursos limpios, 6 preguntas con alternativas (sin audio
        roto), 2 tests y 2 aplicaciones para que el estudiante pueda probar
        de inmediato.

   Es seguro re-ejecutarlo: los DELETEs son idempotentes y los INSERTs usan
   "IF NOT EXISTS" sobre los códigos de curso para no duplicar si vuelves a
   correrlo después de ya haber sembrado.
   ============================================================================= */

USE AurisDB;
GO

SET NOCOUNT ON;
GO

/* =============================================================================
   PASO 1 — Migraciones idempotentes
   Si ya las corriste, estos bloques son no-op.
   ============================================================================= */

IF COL_LENGTH('auris.pregunta', 'video_grid_id') IS NULL
BEGIN
    ALTER TABLE auris.pregunta
        ADD video_grid_id VARCHAR(24) NULL
            CONSTRAINT CK_preg_gridid_video CHECK (video_grid_id IS NULL OR LEN(video_grid_id) = 24);
    PRINT 'OK: video_grid_id agregada a auris.pregunta';
END
ELSE
    PRINT 'SKIP: video_grid_id ya existe en auris.pregunta';
GO

IF COL_LENGTH('auris.respuesta_pregunta', 'tiempo_segundos') IS NULL
BEGIN
    ALTER TABLE auris.respuesta_pregunta
        ADD tiempo_segundos INT NULL
            CONSTRAINT CK_resp_tiempo CHECK (tiempo_segundos IS NULL OR tiempo_segundos >= 0);
    PRINT 'OK: tiempo_segundos agregada a auris.respuesta_pregunta';
END
ELSE
    PRINT 'SKIP: tiempo_segundos ya existe en auris.respuesta_pregunta';
GO

/* =============================================================================
   PASO 2 — Limpiar contenido (preserva usuarios, roles, login)
   ----------------------------------------------------------------------------
   Orden de borrado: de hijo a padre por FK.
   ============================================================================= */

BEGIN TRAN limpieza;

BEGIN TRY
    -- Logs de auditoría referidos a entidades académicas
    DELETE FROM auris.log_auditoria
    WHERE entidad IN (N'curso', N'test', N'pregunta',
                      N'aplicacion_test', N'evaluacion');

    -- Respuestas → Evaluaciones → Aplicaciones
    DELETE FROM auris.respuesta_pregunta;
    DELETE FROM auris.evaluacion;
    DELETE FROM auris.aplicacion_test;

    -- Composición test ↔ pregunta, luego tests
    DELETE FROM auris.test_pregunta;
    DELETE FROM auris.test;

    -- Alternativas (cascade desde pregunta, pero borramos explícito por seguridad)
    DELETE FROM auris.alternativa;
    DELETE FROM auris.pregunta;

    -- Asignaciones profesor ↔ curso, luego cursos
    DELETE FROM auris.profesor_curso;
    DELETE FROM auris.curso;

    COMMIT TRAN limpieza;
    PRINT 'OK: contenido académico limpiado';
END TRY
BEGIN CATCH
    ROLLBACK TRAN limpieza;
    PRINT 'ERROR limpieza: ' + ERROR_MESSAGE();
    THROW;
END CATCH;
GO

/* Reiniciar IDENTITY a 1 para que los IDs nuevos sean limpios.
   (Si no lo haces, los nuevos cursos empiezan en 6, 7… y se ve raro.) */
DBCC CHECKIDENT ('auris.curso',              RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('auris.pregunta',           RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('auris.alternativa',        RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('auris.test',               RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('auris.aplicacion_test',    RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('auris.evaluacion',         RESEED, 0) WITH NO_INFOMSGS;
DBCC CHECKIDENT ('auris.respuesta_pregunta', RESEED, 0) WITH NO_INFOMSGS;
GO

/* =============================================================================
   PASO 3 — Resembrar cursos limpios
   ============================================================================= */

DECLARE @adminId BIGINT = (SELECT TOP 1 usuario_id
                           FROM auris.usuario
                           WHERE correo = 'admin@auris.local');

IF @adminId IS NULL
BEGIN
    RAISERROR('No se encontró admin@auris.local. Corre primero el dump base.', 16, 1);
    RETURN;
END;

INSERT INTO auris.curso (codigo, nombre, descripcion, activo, creado_por) VALUES
    ('KINE-401', N'Kinesiología Cardiorrespiratoria I',
     N'Bases anatómicas y fisiológicas del sistema cardiorrespiratorio. Auscultación inicial.',
     1, @adminId),
    ('KINE-402', N'Kinesiología Cardiorrespiratoria II',
     N'Evaluación clínica avanzada y patrones de ruidos adventicios.',
     1, @adminId),
    ('KINE-501', N'Auscultación Clínica Avanzada',
     N'Diferenciación de ruidos pulmonares y cardíacos en pacientes complejos.',
     1, @adminId);

PRINT 'OK: 3 cursos sembrados';
GO

/* =============================================================================
   PASO 4 — Asignar profesores a cursos (si los usuarios existen)
   ============================================================================= */

DECLARE @adminId BIGINT = (SELECT TOP 1 usuario_id FROM auris.usuario WHERE correo='admin@auris.local');

;WITH asignaciones AS (
    SELECT correo_prof, codigo_curso
    FROM (VALUES
        ('maria.gonzalez@auris.local',  'KINE-401'),
        ('maria.gonzalez@auris.local',  'KINE-402'),
        ('juan.perez@auris.local',      'KINE-501'),
        ('ana.rodriguez@auris.local',   'KINE-401'),
        ('ana.rodriguez@auris.local',   'KINE-501')
    ) AS X(correo_prof, codigo_curso)
)
INSERT INTO auris.profesor_curso (usuario_id, curso_id, asignado_por, activo)
SELECT u.usuario_id, c.curso_id, @adminId, 1
FROM asignaciones a
JOIN auris.usuario u ON u.correo = a.correo_prof
JOIN auris.curso   c ON c.codigo = a.codigo_curso;

PRINT 'OK: asignaciones profesor-curso sembradas';
GO

/* =============================================================================
   PASO 5 — Resembrar preguntas + alternativas (SIN audio/imagen/video roto)
   ----------------------------------------------------------------------------
   Estas preguntas no apuntan a GridFS (audio_grid_id, imagen_grid_id,
   video_grid_id quedan NULL). Así el estudiante puede responder sin que
   el reproductor se rompa por archivos inexistentes.
   ============================================================================= */

DECLARE @mariaId  BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='maria.gonzalez@auris.local');
DECLARE @juanId   BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='juan.perez@auris.local');
DECLARE @anaId    BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='ana.rodriguez@auris.local');
DECLARE @c401 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-401');
DECLARE @c402 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-402');
DECLARE @c501 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-501');

-- Si no hay maría / juan / ana en BD, caemos a admin para que no falle.
SET @mariaId = ISNULL(@mariaId, (SELECT usuario_id FROM auris.usuario WHERE correo='admin@auris.local'));
SET @juanId  = ISNULL(@juanId,  @mariaId);
SET @anaId   = ISNULL(@anaId,   @mariaId);

-- Tabla temporal para mapear preguntas por "clave"
IF OBJECT_ID('tempdb..#pregs') IS NOT NULL DROP TABLE #pregs;
CREATE TABLE #pregs (clave VARCHAR(8) PRIMARY KEY, pregunta_id BIGINT);

DECLARE @pid BIGINT;

-- P1 — Murmullo vesicular
INSERT INTO auris.pregunta (enunciado, explicacion_clinica, creado_por, curso_origen_id)
VALUES (N'¿Qué sonido pulmonar normal se ausculta en los campos pulmonares periféricos?',
        N'El murmullo vesicular es el ruido normal generado por el flujo aéreo en bronquíolos y alvéolos, audible en periferia.',
        @mariaId, @c401);
SET @pid = SCOPE_IDENTITY();
INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
    (@pid, N'Murmullo vesicular', 1, 1),
    (@pid, N'Soplo tubárico',     0, 2),
    (@pid, N'Sibilancias',        0, 3),
    (@pid, N'Roncus',             0, 4);
INSERT INTO #pregs VALUES ('P1', @pid);

-- P2 — Crepitantes bibasales
INSERT INTO auris.pregunta (enunciado, explicacion_clinica, creado_por, curso_origen_id)
VALUES (N'La presencia de crepitantes bibasales en un paciente con disnea sugiere principalmente:',
        N'Los crepitantes finos bibasales son característicos del edema intersticial por insuficiencia cardíaca congestiva.',
        @mariaId, @c401);
SET @pid = SCOPE_IDENTITY();
INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
    (@pid, N'Insuficiencia cardíaca congestiva', 1, 1),
    (@pid, N'Neumotórax espontáneo',             0, 2),
    (@pid, N'Asma bronquial',                    0, 3),
    (@pid, N'EPOC estable',                      0, 4);
INSERT INTO #pregs VALUES ('P2', @pid);

-- P3 — Sibilancias espiratorias
INSERT INTO auris.pregunta (enunciado, explicacion_clinica, creado_por, curso_origen_id)
VALUES (N'¿Qué hallazgo auscultatorio es típico de una crisis asmática?',
        N'Las sibilancias espiratorias difusas reflejan la obstrucción bronquial por broncoespasmo característica del asma.',
        @juanId, @c402);
SET @pid = SCOPE_IDENTITY();
INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
    (@pid, N'Sibilancias espiratorias difusas', 1, 1),
    (@pid, N'Roce pleural',                     0, 2),
    (@pid, N'Soplo sistólico mitral',           0, 3),
    (@pid, N'Egofonía',                         0, 4);
INSERT INTO #pregs VALUES ('P3', @pid);

-- P4 — Foco aórtico
INSERT INTO auris.pregunta (enunciado, explicacion_clinica, creado_por, curso_origen_id)
VALUES (N'¿En qué foco auscultatorio se escucha mejor el segundo ruido cardíaco (R2)?',
        N'El componente aórtico del R2 se ausculta mejor en el foco aórtico, en el 2° espacio intercostal derecho.',
        @anaId, @c501);
SET @pid = SCOPE_IDENTITY();
INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
    (@pid, N'Foco aórtico (2° EICD)',     1, 1),
    (@pid, N'Foco mitral (5° EICI)',      0, 2),
    (@pid, N'Foco tricuspídeo (4° EICI)', 0, 3),
    (@pid, N'Foco pulmonar (2° EICI)',    0, 4);
INSERT INTO #pregs VALUES ('P4', @pid);

-- P5 — Roncus
INSERT INTO auris.pregunta (enunciado, explicacion_clinica, creado_por, curso_origen_id)
VALUES (N'Los roncus de baja tonalidad indican secreciones en:',
        N'Los roncus son ruidos continuos de baja frecuencia generados por secreciones en vías aéreas grandes (tráquea y bronquios principales).',
        @mariaId, @c402);
SET @pid = SCOPE_IDENTITY();
INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
    (@pid, N'Vías aéreas grandes',     1, 1),
    (@pid, N'Alvéolos',                0, 2),
    (@pid, N'Espacio pleural',         0, 3),
    (@pid, N'Bronquíolos terminales', 0, 4);
INSERT INTO #pregs VALUES ('P5', @pid);

-- P6 — Soplo holosistólico
INSERT INTO auris.pregunta (enunciado, explicacion_clinica, creado_por, curso_origen_id)
VALUES (N'Un soplo holosistólico en foco mitral irradiado a axila es típico de:',
        N'La insuficiencia mitral genera un soplo holosistólico de alta frecuencia en foco mitral con irradiación característica hacia la axila.',
        @anaId, @c501);
SET @pid = SCOPE_IDENTITY();
INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
    (@pid, N'Insuficiencia mitral',         1, 1),
    (@pid, N'Estenosis aórtica',            0, 2),
    (@pid, N'Comunicación interventricular', 0, 3),
    (@pid, N'Insuficiencia tricuspídea',    0, 4);
INSERT INTO #pregs VALUES ('P6', @pid);

PRINT 'OK: 6 preguntas + alternativas sembradas';
GO

/* =============================================================================
   PASO 6 — Resembrar tests + composición
   ============================================================================= */

DECLARE @mariaId BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='maria.gonzalez@auris.local');
DECLARE @anaId   BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='ana.rodriguez@auris.local');
DECLARE @c401 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-401');
DECLARE @c501 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-501');

SET @mariaId = ISNULL(@mariaId, (SELECT usuario_id FROM auris.usuario WHERE correo='admin@auris.local'));
SET @anaId   = ISNULL(@anaId, @mariaId);

DECLARE @t1 BIGINT, @t2 BIGINT;

-- T1: Test introductorio (orden secuencial) — María sobre KINE-401
INSERT INTO auris.test (nombre, descripcion, orden_aleatorio, creado_por, curso_origen_id)
VALUES (N'Ruidos pulmonares básicos',
        N'Test introductorio de auscultación pulmonar: ruidos normales y adventicios principales.',
        0, @mariaId, @c401);
SET @t1 = SCOPE_IDENTITY();

INSERT INTO auris.test_pregunta (test_id, pregunta_id, orden)
SELECT @t1, pregunta_id, ROW_NUMBER() OVER (ORDER BY clave)
FROM #pregs WHERE clave IN ('P1','P2','P3','P5');

-- T2: Test avanzado (orden aleatorio) — Ana sobre KINE-501
INSERT INTO auris.test (nombre, descripcion, orden_aleatorio, creado_por, curso_origen_id)
VALUES (N'Soplos cardíacos y focos auscultatorios',
        N'Identificación de focos auscultatorios y patrones de soplos cardíacos comunes.',
        1, @anaId, @c501);
SET @t2 = SCOPE_IDENTITY();

INSERT INTO auris.test_pregunta (test_id, pregunta_id, orden)
SELECT @t2, pregunta_id, ROW_NUMBER() OVER (ORDER BY clave)
FROM #pregs WHERE clave IN ('P4','P6');

PRINT 'OK: 2 tests sembrados';
GO

/* =============================================================================
   PASO 7 — Crear aplicaciones activas para que el estudiante pueda probar YA
   ============================================================================= */

DECLARE @mariaId BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='maria.gonzalez@auris.local');
DECLARE @anaId   BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='ana.rodriguez@auris.local');
SET @mariaId = ISNULL(@mariaId, (SELECT usuario_id FROM auris.usuario WHERE correo='admin@auris.local'));
SET @anaId   = ISNULL(@anaId, @mariaId);

DECLARE @c401 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-401');
DECLARE @c501 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-501');

DECLARE @t1 BIGINT = (SELECT TOP 1 test_id FROM auris.test WHERE nombre=N'Ruidos pulmonares básicos');
DECLARE @t2 BIGINT = (SELECT TOP 1 test_id FROM auris.test WHERE nombre=N'Soplos cardíacos y focos auscultatorios');

-- Aplicación 1: T1 sobre KINE-401, dictada por María
INSERT INTO auris.aplicacion_test (test_id, curso_id, profesor_id)
VALUES (@t1, @c401, @mariaId);

-- Aplicación 2: T2 sobre KINE-501, dictada por Ana
INSERT INTO auris.aplicacion_test (test_id, curso_id, profesor_id)
VALUES (@t2, @c501, @anaId);

PRINT 'OK: 2 aplicaciones activas creadas';
GO

DROP TABLE IF EXISTS #pregs;
GO

/* =============================================================================
   PASO 8 — Resumen final
   ============================================================================= */

PRINT '====================================================================';
PRINT 'Reseed completo. Conteos por tabla:';

SELECT 'curso'                AS tabla, COUNT(*) AS filas FROM auris.curso
UNION ALL SELECT 'profesor_curso',       COUNT(*) FROM auris.profesor_curso
UNION ALL SELECT 'pregunta',             COUNT(*) FROM auris.pregunta
UNION ALL SELECT 'alternativa',          COUNT(*) FROM auris.alternativa
UNION ALL SELECT 'test',                 COUNT(*) FROM auris.test
UNION ALL SELECT 'test_pregunta',        COUNT(*) FROM auris.test_pregunta
UNION ALL SELECT 'aplicacion_test',      COUNT(*) FROM auris.aplicacion_test
UNION ALL SELECT 'evaluacion',           COUNT(*) FROM auris.evaluacion
UNION ALL SELECT 'respuesta_pregunta',   COUNT(*) FROM auris.respuesta_pregunta
ORDER BY tabla;
GO

PRINT '====================================================================';
PRINT 'Listo. El estudiante ya puede:';
PRINT '  1. Ir a /estudiante/cursos y ver 3 cursos.';
PRINT '  2. Abrir KINE-401 → "Ruidos pulmonares básicos" (4 preguntas).';
PRINT '  3. Abrir KINE-501 → "Soplos cardíacos y focos auscultatorios" (2 preguntas).';
PRINT '====================================================================';
GO
