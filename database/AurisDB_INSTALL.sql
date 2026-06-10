/* =============================================================================
   AurisDB - Instalación completa en un solo archivo
   ----------------------------------------------------------------------------
   Genera la BD desde cero: esquema + usuarios + 3 cursos + preguntas + tests
   + aplicaciones. Todo limpio, sin referencias rotas a GridFS.

   QUÉ HACE
   ========
     1. CREATE DATABASE AurisDB (si no existe)
     2. CREATE SCHEMA auris
     3. 11 tablas + índices + triggers + 2 vistas
     4. 3 usuarios (1 admin, 1 superadmin, 1 profesor)
     5. 3 cursos (KINE-401, KINE-402, KINE-501)
     6. 6 preguntas con alternativas (sin audio/imagen/video roto)
     7. 2 tests + 2 aplicaciones activas para que el estudiante pueda probar

   CÓMO EJECUTARLO
   ===============
     SSMS:           File → Open → AurisDB_INSTALL.sql → F5
     sqlcmd:         sqlcmd -S localhost -U sa -P "TU_PASS" -C -i AurisDB_INSTALL.sql
     Azure Data Studio: File → Open → AurisDB_INSTALL.sql → ▶

   PROPIEDADES
   ===========
     · Idempotente: puedes correrlo varias veces sin romper nada.
     · El esquema YA INCLUYE video_grid_id y tiempo_segundos (sin migraciones aparte).
     · Si la BD ya tiene datos, este archivo NO los borra automáticamente.
       Para empezar de cero corre primero:  DROP DATABASE AurisDB;

   CREDENCIALES DE LOGIN
   =====================
     admin@auris.local              ChangeMe!2026     (SUPERADMIN + PROFESOR)
     superadmin@auris.local         ChangeMe!2026    (SUPERADMIN solo)
     juan.perez@auris.local         ChangeMe!2026     (PROFESOR)
   ============================================================================= */

SET NOCOUNT ON;
GO

/* =============================================================================
   1. CREAR BASE DE DATOS Y ESQUEMA
   ============================================================================= */
IF DB_ID(N'AurisDB') IS NULL
BEGIN
    CREATE DATABASE AurisDB;
    PRINT 'Base de datos AurisDB creada.';
END
ELSE
    PRINT 'Base de datos AurisDB ya existe, continuando.';
GO

USE AurisDB;
GO

IF SCHEMA_ID(N'auris') IS NULL
BEGIN
    EXEC('CREATE SCHEMA auris');
    PRINT 'Esquema auris creado.';
END
GO

/* =============================================================================
   2. SEGURIDAD: roles, usuarios, refresh tokens, login, invitaciones
   ============================================================================= */

IF OBJECT_ID(N'auris.rol', N'U') IS NULL
CREATE TABLE auris.rol (
    rol_id          TINYINT          NOT NULL PRIMARY KEY,
    codigo          VARCHAR(20)      NOT NULL UNIQUE,
    descripcion     NVARCHAR(120)    NOT NULL
);
GO

IF OBJECT_ID(N'auris.usuario', N'U') IS NULL
CREATE TABLE auris.usuario (
    usuario_id          BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    nombre              NVARCHAR(120)   NOT NULL,
    correo              NVARCHAR(254)   NOT NULL,
    password_hash       NVARCHAR(255)   NOT NULL,
    activo              BIT             NOT NULL CONSTRAINT DF_usuario_activo DEFAULT (1),
    created_at          DATETIME2(3)    NOT NULL CONSTRAINT DF_usuario_created DEFAULT (SYSUTCDATETIME()),
    updated_at          DATETIME2(3)    NOT NULL CONSTRAINT DF_usuario_updated DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_usuario_correo UNIQUE (correo),
    CONSTRAINT CK_usuario_correo_formato CHECK (correo LIKE '%_@_%._%')
);
GO

IF OBJECT_ID(N'auris.usuario_rol', N'U') IS NULL
CREATE TABLE auris.usuario_rol (
    usuario_id      BIGINT       NOT NULL,
    rol_id          TINYINT      NOT NULL,
    asignado_en     DATETIME2(3) NOT NULL CONSTRAINT DF_usurol_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_usuario_rol PRIMARY KEY (usuario_id, rol_id),
    CONSTRAINT FK_usurol_usuario FOREIGN KEY (usuario_id) REFERENCES auris.usuario(usuario_id) ON DELETE CASCADE,
    CONSTRAINT FK_usurol_rol     FOREIGN KEY (rol_id)     REFERENCES auris.rol(rol_id)
);
GO

IF OBJECT_ID(N'auris.refresh_token', N'U') IS NULL
CREATE TABLE auris.refresh_token (
    refresh_token_id    BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    usuario_id          BIGINT          NOT NULL,
    token_hash          CHAR(64)        NOT NULL,
    emitido_en          DATETIME2(3)    NOT NULL CONSTRAINT DF_rt_emit DEFAULT (SYSUTCDATETIME()),
    expira_en           DATETIME2(3)    NOT NULL,
    revocado_en         DATETIME2(3)    NULL,
    ip_origen           VARCHAR(45)     NULL,
    user_agent          NVARCHAR(400)   NULL,
    CONSTRAINT FK_rt_usuario FOREIGN KEY (usuario_id) REFERENCES auris.usuario(usuario_id) ON DELETE CASCADE,
    CONSTRAINT UQ_rt_token_hash UNIQUE (token_hash)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_rt_usuario_expira' AND object_id = OBJECT_ID('auris.refresh_token'))
    CREATE INDEX IX_rt_usuario_expira ON auris.refresh_token(usuario_id, expira_en);
GO

IF OBJECT_ID(N'auris.login_intento', N'U') IS NULL
CREATE TABLE auris.login_intento (
    login_intento_id    BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    correo              NVARCHAR(254)   NOT NULL,
    exitoso             BIT             NOT NULL,
    ip_origen           VARCHAR(45)     NULL,
    ocurrido_en         DATETIME2(3)    NOT NULL CONSTRAINT DF_li_at DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_li_correo_fecha' AND object_id = OBJECT_ID('auris.login_intento'))
    CREATE INDEX IX_li_correo_fecha ON auris.login_intento(correo, ocurrido_en DESC);
GO

-- Tokens de reseteo de contraseña ("olvidé mi contraseña"). Tokens de un solo
-- uso (hash sha256) con expiración corta. Los usa solicitarReset / resetearPassword,
-- y cambiarPassword invalida los resets pendientes del usuario.
IF OBJECT_ID(N'auris.password_reset', N'U') IS NULL
CREATE TABLE auris.password_reset (
    reset_id            BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    usuario_id          BIGINT          NOT NULL,
    token_hash          CHAR(64)        NOT NULL,
    expira_en           DATETIME2(3)    NOT NULL,
    usado_en            DATETIME2(3)    NULL,
    creado_en           DATETIME2(3)    NOT NULL CONSTRAINT DF_pwreset_created DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_pwreset_usuario FOREIGN KEY (usuario_id) REFERENCES auris.usuario(usuario_id) ON DELETE CASCADE
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pwreset_token' AND object_id = OBJECT_ID('auris.password_reset'))
    CREATE INDEX IX_pwreset_token ON auris.password_reset(token_hash);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pwreset_usuario' AND object_id = OBJECT_ID('auris.password_reset'))
    CREATE INDEX IX_pwreset_usuario ON auris.password_reset(usuario_id, usado_en);
GO

IF OBJECT_ID(N'auris.invitacion_profesor', N'U') IS NULL
CREATE TABLE auris.invitacion_profesor (
    invitacion_id        UNIQUEIDENTIFIER NOT NULL PRIMARY KEY
                             CONSTRAINT DF_inv_id DEFAULT (NEWID()),
    correo_destino       NVARCHAR(254)   NOT NULL,
    token_hash           CHAR(64)        NOT NULL UNIQUE,
    estado               VARCHAR(20)     NOT NULL,
    expira_en            DATETIME2(3)    NOT NULL,
    creada_por           BIGINT          NOT NULL,
    creada_en            DATETIME2(3)    NOT NULL CONSTRAINT DF_inv_created DEFAULT (SYSUTCDATETIME()),
    completada_en        DATETIME2(3)    NULL,
    usuario_id_creado    BIGINT          NULL,
    invitacion_previa_id UNIQUEIDENTIFIER NULL,
    CONSTRAINT FK_inv_super  FOREIGN KEY (creada_por)           REFERENCES auris.usuario(usuario_id),
    CONSTRAINT FK_inv_creado FOREIGN KEY (usuario_id_creado)    REFERENCES auris.usuario(usuario_id),
    CONSTRAINT FK_inv_previa FOREIGN KEY (invitacion_previa_id) REFERENCES auris.invitacion_profesor(invitacion_id),
    CONSTRAINT CK_inv_estado CHECK (estado IN ('PENDIENTE','COMPLETADA','EXPIRADA','REENVIADA'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_inv_correo_estado' AND object_id = OBJECT_ID('auris.invitacion_profesor'))
    CREATE INDEX IX_inv_correo_estado ON auris.invitacion_profesor(correo_destino, estado);
GO

/* =============================================================================
   3. ACADÉMICO: cursos y asignaciones
   ============================================================================= */

IF OBJECT_ID(N'auris.curso', N'U') IS NULL
CREATE TABLE auris.curso (
    curso_id            BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    codigo              VARCHAR(40)     NOT NULL UNIQUE,
    nombre              NVARCHAR(160)   NOT NULL,
    descripcion         NVARCHAR(1000)  NULL,
    activo              BIT             NOT NULL CONSTRAINT DF_curso_activo DEFAULT (1),
    creado_por          BIGINT          NOT NULL,
    created_at          DATETIME2(3)    NOT NULL CONSTRAINT DF_curso_created DEFAULT (SYSUTCDATETIME()),
    updated_at          DATETIME2(3)    NOT NULL CONSTRAINT DF_curso_updated DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_curso_creador FOREIGN KEY (creado_por) REFERENCES auris.usuario(usuario_id)
);
GO

IF OBJECT_ID(N'auris.profesor_curso', N'U') IS NULL
CREATE TABLE auris.profesor_curso (
    usuario_id      BIGINT       NOT NULL,
    curso_id        BIGINT       NOT NULL,
    asignado_por    BIGINT       NOT NULL,
    asignado_en     DATETIME2(3) NOT NULL CONSTRAINT DF_pc_at DEFAULT (SYSUTCDATETIME()),
    activo          BIT          NOT NULL CONSTRAINT DF_pc_activo DEFAULT (1),
    CONSTRAINT PK_profesor_curso PRIMARY KEY (usuario_id, curso_id),
    CONSTRAINT FK_pc_usuario  FOREIGN KEY (usuario_id)   REFERENCES auris.usuario(usuario_id),
    CONSTRAINT FK_pc_curso    FOREIGN KEY (curso_id)     REFERENCES auris.curso(curso_id),
    CONSTRAINT FK_pc_super    FOREIGN KEY (asignado_por) REFERENCES auris.usuario(usuario_id)
);
GO

/* =============================================================================
   4. CONTENIDO: preguntas (con video), alternativas, tests
   ============================================================================= */

-- Pregunta: incluye video_grid_id inline (antes era migración aparte)
IF OBJECT_ID(N'auris.pregunta', N'U') IS NULL
CREATE TABLE auris.pregunta (
    pregunta_id         BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    enunciado           NVARCHAR(MAX)   NOT NULL,
    explicacion_clinica NVARCHAR(4000)  NOT NULL,
    audio_grid_id       VARCHAR(24)     NULL,
    imagen_grid_id      VARCHAR(24)     NULL,
    video_grid_id       VARCHAR(24)     NULL,
    creado_por          BIGINT          NOT NULL,
    curso_origen_id     BIGINT          NULL,
    clonada_de_id       BIGINT          NULL,
    activo              BIT             NOT NULL CONSTRAINT DF_preg_activo DEFAULT (1),
    created_at          DATETIME2(3)    NOT NULL CONSTRAINT DF_preg_created DEFAULT (SYSUTCDATETIME()),
    updated_at          DATETIME2(3)    NOT NULL CONSTRAINT DF_preg_updated DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_preg_autor  FOREIGN KEY (creado_por)      REFERENCES auris.usuario(usuario_id),
    CONSTRAINT FK_preg_curso  FOREIGN KEY (curso_origen_id) REFERENCES auris.curso(curso_id),
    CONSTRAINT FK_preg_clon   FOREIGN KEY (clonada_de_id)   REFERENCES auris.pregunta(pregunta_id),
    CONSTRAINT CK_preg_gridid_audio  CHECK (audio_grid_id  IS NULL OR LEN(audio_grid_id)  = 24),
    CONSTRAINT CK_preg_gridid_imagen CHECK (imagen_grid_id IS NULL OR LEN(imagen_grid_id) = 24),
    CONSTRAINT CK_preg_gridid_video  CHECK (video_grid_id  IS NULL OR LEN(video_grid_id)  = 24)
);
GO

-- Si la tabla ya existía sin video_grid_id, la agregamos (caso BD pre-existente)
IF COL_LENGTH('auris.pregunta', 'video_grid_id') IS NULL
BEGIN
    ALTER TABLE auris.pregunta
        ADD video_grid_id VARCHAR(24) NULL
            CONSTRAINT CK_preg_gridid_video CHECK (video_grid_id IS NULL OR LEN(video_grid_id) = 24);
    PRINT 'Columna video_grid_id agregada a auris.pregunta';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_preg_curso' AND object_id = OBJECT_ID('auris.pregunta'))
    CREATE INDEX IX_preg_curso ON auris.pregunta(curso_origen_id) WHERE activo = 1;
GO

IF OBJECT_ID(N'auris.alternativa', N'U') IS NULL
CREATE TABLE auris.alternativa (
    alternativa_id      BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    pregunta_id         BIGINT          NOT NULL,
    texto               NVARCHAR(1000)  NOT NULL,
    es_correcta         BIT             NOT NULL CONSTRAINT DF_alt_correcta DEFAULT (0),
    orden               TINYINT         NOT NULL,
    CONSTRAINT FK_alt_pregunta FOREIGN KEY (pregunta_id) REFERENCES auris.pregunta(pregunta_id) ON DELETE CASCADE,
    CONSTRAINT UQ_alt_pregunta_orden UNIQUE (pregunta_id, orden),
    CONSTRAINT CK_alt_orden CHECK (orden BETWEEN 1 AND 5)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_alt_unica_correcta' AND object_id = OBJECT_ID('auris.alternativa'))
    CREATE UNIQUE INDEX UX_alt_unica_correcta ON auris.alternativa(pregunta_id) WHERE es_correcta = 1;
GO

IF OBJECT_ID(N'auris.test', N'U') IS NULL
CREATE TABLE auris.test (
    test_id             BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    nombre              NVARCHAR(200)   NOT NULL,
    descripcion         NVARCHAR(1000)  NULL,
    orden_aleatorio     BIT             NOT NULL CONSTRAINT DF_test_orden DEFAULT (0),
    creado_por          BIGINT          NOT NULL,
    curso_origen_id     BIGINT          NULL,
    clonado_de_id       BIGINT          NULL,
    activo              BIT             NOT NULL CONSTRAINT DF_test_activo DEFAULT (1),
    created_at          DATETIME2(3)    NOT NULL CONSTRAINT DF_test_created DEFAULT (SYSUTCDATETIME()),
    updated_at          DATETIME2(3)    NOT NULL CONSTRAINT DF_test_updated DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_test_autor FOREIGN KEY (creado_por)      REFERENCES auris.usuario(usuario_id),
    CONSTRAINT FK_test_curso FOREIGN KEY (curso_origen_id) REFERENCES auris.curso(curso_id),
    CONSTRAINT FK_test_clon  FOREIGN KEY (clonado_de_id)   REFERENCES auris.test(test_id)
);
GO

IF OBJECT_ID(N'auris.test_pregunta', N'U') IS NULL
CREATE TABLE auris.test_pregunta (
    test_id         BIGINT      NOT NULL,
    pregunta_id     BIGINT      NOT NULL,
    orden           SMALLINT    NOT NULL,
    CONSTRAINT PK_test_pregunta PRIMARY KEY (test_id, pregunta_id),
    CONSTRAINT FK_tp_test     FOREIGN KEY (test_id)     REFERENCES auris.test(test_id) ON DELETE CASCADE,
    CONSTRAINT FK_tp_pregunta FOREIGN KEY (pregunta_id) REFERENCES auris.pregunta(pregunta_id),
    CONSTRAINT UQ_tp_orden    UNIQUE (test_id, orden),
    CONSTRAINT CK_tp_orden    CHECK (orden >= 1)
);
GO

/* =============================================================================
   5. APLICACIÓN DE TEST
   ============================================================================= */

IF OBJECT_ID(N'auris.aplicacion_test', N'U') IS NULL
CREATE TABLE auris.aplicacion_test (
    aplicacion_id       BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    aplicacion_uuid     UNIQUEIDENTIFIER NOT NULL UNIQUE
                            CONSTRAINT DF_apl_uuid DEFAULT (NEWID()),
    test_id             BIGINT          NOT NULL,
    curso_id            BIGINT          NOT NULL,
    profesor_id         BIGINT          NOT NULL,
    activo              BIT             NOT NULL CONSTRAINT DF_apl_activo DEFAULT (1),
    visible_desde       DATETIME2(3)    NULL,
    visible_hasta       DATETIME2(3)    NULL,
    created_at          DATETIME2(3)    NOT NULL CONSTRAINT DF_apl_created DEFAULT (SYSUTCDATETIME()),
    updated_at          DATETIME2(3)    NOT NULL CONSTRAINT DF_apl_updated DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_apl_test  FOREIGN KEY (test_id)     REFERENCES auris.test(test_id),
    CONSTRAINT FK_apl_curso FOREIGN KEY (curso_id)    REFERENCES auris.curso(curso_id),
    CONSTRAINT FK_apl_prof  FOREIGN KEY (profesor_id) REFERENCES auris.usuario(usuario_id),
    CONSTRAINT UQ_apl_curso_test UNIQUE (curso_id, test_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_apl_curso_activo' AND object_id = OBJECT_ID('auris.aplicacion_test'))
    CREATE INDEX IX_apl_curso_activo ON auris.aplicacion_test(curso_id, activo);
GO

/* =============================================================================
   6. EJECUCIÓN DEL ESTUDIANTE: evaluaciones y respuestas (con tiempo_segundos)
   ============================================================================= */

IF OBJECT_ID(N'auris.evaluacion', N'U') IS NULL
CREATE TABLE auris.evaluacion (
    evaluacion_id       BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    evaluacion_uuid     UNIQUEIDENTIFIER NOT NULL UNIQUE
                            CONSTRAINT DF_eval_uuid DEFAULT (NEWID()),
    aplicacion_id       BIGINT          NOT NULL,
    modalidad           VARCHAR(15)     NOT NULL,
    correo_estudiante   NVARCHAR(254)   NULL,
    estado              VARCHAR(15)     NOT NULL CONSTRAINT DF_eval_estado DEFAULT ('EN_CURSO'),
    iniciada_en         DATETIME2(3)    NOT NULL CONSTRAINT DF_eval_iniciada DEFAULT (SYSUTCDATETIME()),
    finalizada_en       DATETIME2(3)    NULL,
    total_preguntas     SMALLINT        NULL,
    aciertos_primer     SMALLINT        NULL,
    aciertos_segundo    SMALLINT        NULL,
    incorrectas         SMALLINT        NULL,
    porcentaje_global   DECIMAL(5,2)    NULL,
    informe_enviado_en  DATETIME2(3)    NULL,
    CONSTRAINT FK_eval_aplicacion FOREIGN KEY (aplicacion_id) REFERENCES auris.aplicacion_test(aplicacion_id),
    CONSTRAINT CK_eval_modalidad CHECK (modalidad IN ('ANONIMA','IDENTIFICADA')),
    CONSTRAINT CK_eval_estado    CHECK (estado IN ('EN_CURSO','FINALIZADA','ABANDONADA')),
    CONSTRAINT CK_eval_correo_consistente CHECK (
        (modalidad = 'IDENTIFICADA' AND correo_estudiante IS NOT NULL)
        OR
        (modalidad = 'ANONIMA' AND correo_estudiante IS NULL)
    )
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_eval_aplicacion_estado' AND object_id = OBJECT_ID('auris.evaluacion'))
    CREATE INDEX IX_eval_aplicacion_estado ON auris.evaluacion(aplicacion_id, estado);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_eval_finalizada_modalidad' AND object_id = OBJECT_ID('auris.evaluacion'))
    CREATE INDEX IX_eval_finalizada_modalidad ON auris.evaluacion(finalizada_en, modalidad);
GO

-- Respuesta_pregunta: incluye tiempo_segundos inline
IF OBJECT_ID(N'auris.respuesta_pregunta', N'U') IS NULL
CREATE TABLE auris.respuesta_pregunta (
    respuesta_id            BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    evaluacion_id           BIGINT          NOT NULL,
    pregunta_id             BIGINT          NOT NULL,
    orden_presentacion      SMALLINT        NOT NULL,
    alternativa_intento1_id BIGINT          NULL,
    correcta_intento1       BIT             NULL,
    alternativa_intento2_id BIGINT          NULL,
    correcta_intento2       BIT             NULL,
    intentos_usados         TINYINT         NOT NULL CONSTRAINT DF_resp_intentos DEFAULT (0),
    resultado               VARCHAR(20)     NULL,
    tiempo_segundos         INT             NULL,
    respondida_en           DATETIME2(3)    NOT NULL CONSTRAINT DF_resp_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_resp_eval     FOREIGN KEY (evaluacion_id)           REFERENCES auris.evaluacion(evaluacion_id) ON DELETE CASCADE,
    CONSTRAINT FK_resp_pregunta FOREIGN KEY (pregunta_id)             REFERENCES auris.pregunta(pregunta_id),
    CONSTRAINT FK_resp_alt1     FOREIGN KEY (alternativa_intento1_id) REFERENCES auris.alternativa(alternativa_id),
    CONSTRAINT FK_resp_alt2     FOREIGN KEY (alternativa_intento2_id) REFERENCES auris.alternativa(alternativa_id),
    CONSTRAINT UQ_resp_eval_preg UNIQUE (evaluacion_id, pregunta_id),
    CONSTRAINT CK_resp_intentos CHECK (intentos_usados BETWEEN 0 AND 2),
    CONSTRAINT CK_resp_resultado CHECK (resultado IS NULL OR resultado IN ('CORRECTA_INT1','CORRECTA_INT2','INCORRECTA')),
    CONSTRAINT CK_resp_tiempo CHECK (tiempo_segundos IS NULL OR tiempo_segundos >= 0)
);
GO

-- Si la tabla ya existía sin tiempo_segundos, la agregamos
IF COL_LENGTH('auris.respuesta_pregunta', 'tiempo_segundos') IS NULL
BEGIN
    ALTER TABLE auris.respuesta_pregunta
        ADD tiempo_segundos INT NULL
            CONSTRAINT CK_resp_tiempo CHECK (tiempo_segundos IS NULL OR tiempo_segundos >= 0);
    PRINT 'Columna tiempo_segundos agregada a auris.respuesta_pregunta';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_resp_pregunta_resultado' AND object_id = OBJECT_ID('auris.respuesta_pregunta'))
    CREATE INDEX IX_resp_pregunta_resultado ON auris.respuesta_pregunta(pregunta_id, resultado);
GO

/* =============================================================================
   7. AUDITORÍA
   ============================================================================= */

IF OBJECT_ID(N'auris.log_auditoria', N'U') IS NULL
CREATE TABLE auris.log_auditoria (
    log_id          BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    usuario_id      BIGINT          NULL,
    accion          VARCHAR(60)     NOT NULL,
    entidad         VARCHAR(60)     NOT NULL,
    entidad_id      VARCHAR(60)     NULL,
    detalle_json    NVARCHAR(MAX)   NULL,
    ip_origen       VARCHAR(45)     NULL,
    ocurrido_en     DATETIME2(3)    NOT NULL CONSTRAINT DF_log_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_log_usuario FOREIGN KEY (usuario_id) REFERENCES auris.usuario(usuario_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_log_fecha' AND object_id = OBJECT_ID('auris.log_auditoria'))
    CREATE INDEX IX_log_fecha ON auris.log_auditoria(ocurrido_en DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_log_entidad' AND object_id = OBJECT_ID('auris.log_auditoria'))
    CREATE INDEX IX_log_entidad ON auris.log_auditoria(entidad, entidad_id);
GO

/* =============================================================================
   8. TRIGGERS de updated_at
   ============================================================================= */

CREATE OR ALTER TRIGGER auris.tr_usuario_updated ON auris.usuario AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE u SET updated_at = SYSUTCDATETIME()
    FROM auris.usuario u INNER JOIN inserted i ON u.usuario_id = i.usuario_id;
END;
GO

CREATE OR ALTER TRIGGER auris.tr_curso_updated ON auris.curso AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE c SET updated_at = SYSUTCDATETIME()
    FROM auris.curso c INNER JOIN inserted i ON c.curso_id = i.curso_id;
END;
GO

CREATE OR ALTER TRIGGER auris.tr_pregunta_updated ON auris.pregunta AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE p SET updated_at = SYSUTCDATETIME()
    FROM auris.pregunta p INNER JOIN inserted i ON p.pregunta_id = i.pregunta_id;
END;
GO

CREATE OR ALTER TRIGGER auris.tr_test_updated ON auris.test AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE t SET updated_at = SYSUTCDATETIME()
    FROM auris.test t INNER JOIN inserted i ON t.test_id = i.test_id;
END;
GO

CREATE OR ALTER TRIGGER auris.tr_apl_updated ON auris.aplicacion_test AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE a SET updated_at = SYSUTCDATETIME()
    FROM auris.aplicacion_test a INNER JOIN inserted i ON a.aplicacion_id = i.aplicacion_id;
END;
GO

/* =============================================================================
   9. VISTAS de analítica docente
   ============================================================================= */

CREATE OR ALTER VIEW auris.vw_stats_pregunta_aplicacion AS
SELECT
    apl.aplicacion_id,
    apl.curso_id,
    apl.test_id,
    rp.pregunta_id,
    COUNT(*)                                                       AS total_respuestas,
    SUM(CASE WHEN rp.resultado = 'CORRECTA_INT1' THEN 1 ELSE 0 END) AS aciertos_int1,
    SUM(CASE WHEN rp.resultado = 'CORRECTA_INT2' THEN 1 ELSE 0 END) AS aciertos_int2,
    SUM(CASE WHEN rp.resultado = 'INCORRECTA'    THEN 1 ELSE 0 END) AS errores,
    SUM(CAST(rp.intentos_usados AS INT))                            AS total_intentos
FROM auris.respuesta_pregunta rp
INNER JOIN auris.evaluacion       ev  ON ev.evaluacion_id  = rp.evaluacion_id
INNER JOIN auris.aplicacion_test  apl ON apl.aplicacion_id = ev.aplicacion_id
WHERE ev.estado = 'FINALIZADA'
GROUP BY apl.aplicacion_id, apl.curso_id, apl.test_id, rp.pregunta_id;
GO

CREATE OR ALTER VIEW auris.vw_porcentaje_aplicacion AS
SELECT
    ev.aplicacion_id,
    COUNT(*)                                                       AS total_evaluaciones,
    SUM(CASE WHEN ev.modalidad = 'ANONIMA'      THEN 1 ELSE 0 END) AS evaluaciones_anonimas,
    SUM(CASE WHEN ev.modalidad = 'IDENTIFICADA' THEN 1 ELSE 0 END) AS evaluaciones_identificadas,
    AVG(ev.porcentaje_global)                                      AS porcentaje_promedio
FROM auris.evaluacion ev
WHERE ev.estado = 'FINALIZADA'
GROUP BY ev.aplicacion_id;
GO

/* =============================================================================
   10. SEED — Roles, admin y superadmin
   ============================================================================= */

SET XACT_ABORT ON;
BEGIN TRAN seed_seguridad;

IF NOT EXISTS (SELECT 1 FROM auris.rol WHERE rol_id = 1)
    INSERT INTO auris.rol (rol_id, codigo, descripcion) VALUES
        (1, 'SUPERADMIN', N'Administrador del sistema. Privilegios máximos.'),
        (2, 'PROFESOR',   N'Crea contenido, gestiona tests y consulta analítica de sus cursos.');

-- Admin (SUPERADMIN + PROFESOR) — password: ChangeMe!2026
IF NOT EXISTS (SELECT 1 FROM auris.usuario WHERE correo = 'admin@auris.local')
BEGIN
    DECLARE @adminId BIGINT;
    INSERT INTO auris.usuario (nombre, correo, password_hash, activo)
    VALUES (N'Administrador Auris',
            'admin@auris.local',
            '$2b$12$dv98sIkhzuXJl9r9RysA3eKOLMlcDBHYCTnYSnsOJQ7ll7lnvkrWO',
            1);
    SET @adminId = SCOPE_IDENTITY();
    INSERT INTO auris.usuario_rol (usuario_id, rol_id) VALUES (@adminId, 1), (@adminId, 2);
END;

-- Superadmin "puro" (solo SUPERADMIN) — password: ChangeMe!2026
IF NOT EXISTS (SELECT 1 FROM auris.usuario WHERE correo = 'superadmin@auris.local')
BEGIN
    DECLARE @superId BIGINT;
    INSERT INTO auris.usuario (nombre, correo, password_hash, activo)
    VALUES (N'Super Admin Demo',
            'superadmin@auris.local',
            '$2b$12$dv98sIkhzuXJl9r9RysA3eKOLMlcDBHYCTnYSnsOJQ7ll7lnvkrWO',
            1);
    SET @superId = SCOPE_IDENTITY();
    INSERT INTO auris.usuario_rol (usuario_id, rol_id) VALUES (@superId, 1);
END;

-- Profesor demo — password: ChangeMe!2026
DECLARE @hashProf NVARCHAR(255) = '$2b$12$dv98sIkhzuXJl9r9RysA3eKOLMlcDBHYCTnYSnsOJQ7ll7lnvkrWO';

IF NOT EXISTS (SELECT 1 FROM auris.usuario WHERE correo='juan.perez@auris.local')
    INSERT INTO auris.usuario (nombre, correo, password_hash, activo) VALUES
        (N'Juan Pérez', 'juan.perez@auris.local', @hashProf, 1);

-- Asignar rol PROFESOR (idempotente)
INSERT INTO auris.usuario_rol (usuario_id, rol_id)
SELECT u.usuario_id, 2
FROM auris.usuario u
WHERE u.correo = 'juan.perez@auris.local'
  AND NOT EXISTS (SELECT 1 FROM auris.usuario_rol ur WHERE ur.usuario_id=u.usuario_id AND ur.rol_id=2);

COMMIT TRAN seed_seguridad;
GO

PRINT 'OK: usuarios y roles sembrados';
GO

/* =============================================================================
   11. SEED — Cursos (3 cursos activos)
   ============================================================================= */

DECLARE @adminId BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='admin@auris.local');

IF NOT EXISTS (SELECT 1 FROM auris.curso WHERE codigo='KINE-401')
    INSERT INTO auris.curso (codigo, nombre, descripcion, activo, creado_por) VALUES
        ('KINE-401', N'Kinesiología Cardiorrespiratoria I',
         N'Bases anatómicas y fisiológicas del sistema cardiorrespiratorio. Auscultación inicial.',
         1, @adminId);

IF NOT EXISTS (SELECT 1 FROM auris.curso WHERE codigo='KINE-402')
    INSERT INTO auris.curso (codigo, nombre, descripcion, activo, creado_por) VALUES
        ('KINE-402', N'Kinesiología Cardiorrespiratoria II',
         N'Evaluación clínica avanzada y patrones de ruidos adventicios.',
         1, @adminId);

IF NOT EXISTS (SELECT 1 FROM auris.curso WHERE codigo='KINE-501')
    INSERT INTO auris.curso (codigo, nombre, descripcion, activo, creado_por) VALUES
        ('KINE-501', N'Auscultación Clínica Avanzada',
         N'Diferenciación de ruidos pulmonares y cardíacos en pacientes complejos.',
         1, @adminId);

PRINT 'OK: 3 cursos sembrados';
GO

/* =============================================================================
   12. SEED — Asignaciones profesor ↔ curso
   ============================================================================= */

DECLARE @adminId BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='admin@auris.local');

;WITH asignaciones AS (
    SELECT correo_prof, codigo_curso
    FROM (VALUES
        ('juan.perez@auris.local',      'KINE-401'),
        ('juan.perez@auris.local',      'KINE-402'),
        ('juan.perez@auris.local',      'KINE-501')
    ) AS X(correo_prof, codigo_curso)
)
INSERT INTO auris.profesor_curso (usuario_id, curso_id, asignado_por, activo)
SELECT u.usuario_id, c.curso_id, @adminId, 1
FROM asignaciones a
JOIN auris.usuario u ON u.correo = a.correo_prof
JOIN auris.curso   c ON c.codigo = a.codigo_curso
WHERE NOT EXISTS (
    SELECT 1 FROM auris.profesor_curso pc
    WHERE pc.usuario_id = u.usuario_id AND pc.curso_id = c.curso_id
);

PRINT 'OK: asignaciones profesor-curso sembradas';
GO

/* =============================================================================
   13. SEED — Preguntas + alternativas (6 preguntas, sin multimedia rota)
   ============================================================================= */

DECLARE @mariaId BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='juan.perez@auris.local'); -- María eliminada: contenido demo reasignado a juan.perez
DECLARE @juanId  BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='juan.perez@auris.local');
DECLARE @anaId   BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='juan.perez@auris.local'); -- Ana eliminada: contenido demo reasignado a juan.perez
DECLARE @c401 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-401');
DECLARE @c402 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-402');
DECLARE @c501 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-501');

-- Tabla temporal para mapear preguntas por clave
IF OBJECT_ID('tempdb..#pregs') IS NOT NULL DROP TABLE #pregs;
CREATE TABLE #pregs (clave VARCHAR(8) PRIMARY KEY, pregunta_id BIGINT);

DECLARE @pid BIGINT, @e NVARCHAR(2000);

-- P1
SET @e = N'¿Qué sonido pulmonar normal se ausculta en los campos pulmonares periféricos?';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, creado_por, curso_origen_id)
    VALUES (@e,
            N'El murmullo vesicular es el ruido normal generado por el flujo aéreo en bronquíolos y alvéolos, audible en periferia.',
            @mariaId, @c401);
    SET @pid = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@pid, N'Murmullo vesicular', 1, 1),
        (@pid, N'Soplo tubárico',     0, 2),
        (@pid, N'Sibilancias',        0, 3),
        (@pid, N'Roncus',             0, 4);
    INSERT INTO #pregs VALUES ('P1', @pid);
END ELSE INSERT INTO #pregs SELECT 'P1', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

-- P2
SET @e = N'La presencia de crepitantes bibasales en un paciente con disnea sugiere principalmente:';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, creado_por, curso_origen_id)
    VALUES (@e,
            N'Los crepitantes finos bibasales son característicos del edema intersticial por insuficiencia cardíaca congestiva.',
            @mariaId, @c401);
    SET @pid = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@pid, N'Insuficiencia cardíaca congestiva', 1, 1),
        (@pid, N'Neumotórax espontáneo',             0, 2),
        (@pid, N'Asma bronquial',                    0, 3),
        (@pid, N'EPOC estable',                      0, 4);
    INSERT INTO #pregs VALUES ('P2', @pid);
END ELSE INSERT INTO #pregs SELECT 'P2', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

-- P3
SET @e = N'¿Qué hallazgo auscultatorio es típico de una crisis asmática?';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, creado_por, curso_origen_id)
    VALUES (@e,
            N'Las sibilancias espiratorias difusas reflejan la obstrucción bronquial por broncoespasmo característica del asma.',
            @juanId, @c402);
    SET @pid = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@pid, N'Sibilancias espiratorias difusas', 1, 1),
        (@pid, N'Roce pleural',                     0, 2),
        (@pid, N'Soplo sistólico mitral',           0, 3),
        (@pid, N'Egofonía',                         0, 4);
    INSERT INTO #pregs VALUES ('P3', @pid);
END ELSE INSERT INTO #pregs SELECT 'P3', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

-- P4
SET @e = N'¿En qué foco auscultatorio se escucha mejor el segundo ruido cardíaco (R2)?';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, creado_por, curso_origen_id)
    VALUES (@e,
            N'El componente aórtico del R2 se ausculta mejor en el foco aórtico, en el 2° espacio intercostal derecho.',
            @anaId, @c501);
    SET @pid = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@pid, N'Foco aórtico (2° EICD)',     1, 1),
        (@pid, N'Foco mitral (5° EICI)',      0, 2),
        (@pid, N'Foco tricuspídeo (4° EICI)', 0, 3),
        (@pid, N'Foco pulmonar (2° EICI)',    0, 4);
    INSERT INTO #pregs VALUES ('P4', @pid);
END ELSE INSERT INTO #pregs SELECT 'P4', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

-- P5
SET @e = N'Los roncus de baja tonalidad indican secreciones en:';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, creado_por, curso_origen_id)
    VALUES (@e,
            N'Los roncus son ruidos continuos de baja frecuencia generados por secreciones en vías aéreas grandes (tráquea y bronquios principales).',
            @mariaId, @c402);
    SET @pid = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@pid, N'Vías aéreas grandes',     1, 1),
        (@pid, N'Alvéolos',                0, 2),
        (@pid, N'Espacio pleural',         0, 3),
        (@pid, N'Bronquíolos terminales', 0, 4);
    INSERT INTO #pregs VALUES ('P5', @pid);
END ELSE INSERT INTO #pregs SELECT 'P5', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

-- P6
SET @e = N'Un soplo holosistólico en foco mitral irradiado a axila es típico de:';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, creado_por, curso_origen_id)
    VALUES (@e,
            N'La insuficiencia mitral genera un soplo holosistólico de alta frecuencia en foco mitral con irradiación característica hacia la axila.',
            @anaId, @c501);
    SET @pid = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@pid, N'Insuficiencia mitral',          1, 1),
        (@pid, N'Estenosis aórtica',             0, 2),
        (@pid, N'Comunicación interventricular', 0, 3),
        (@pid, N'Insuficiencia tricuspídea',     0, 4);
    INSERT INTO #pregs VALUES ('P6', @pid);
END ELSE INSERT INTO #pregs SELECT 'P6', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

PRINT 'OK: 6 preguntas + alternativas sembradas';
GO

/* =============================================================================
   14. SEED — Tests + composición test ↔ pregunta
   ============================================================================= */

DECLARE @mariaId BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='juan.perez@auris.local'); -- María eliminada: contenido demo reasignado a juan.perez
DECLARE @anaId   BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='juan.perez@auris.local'); -- Ana eliminada: contenido demo reasignado a juan.perez
DECLARE @c401 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-401');
DECLARE @c501 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-501');

DECLARE @t1 BIGINT, @t2 BIGINT;

-- IDs de las preguntas por enunciado (preguntas ya sembradas en paso 13)
DECLARE @p1 BIGINT = (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=N'¿Qué sonido pulmonar normal se ausculta en los campos pulmonares periféricos?');
DECLARE @p2 BIGINT = (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=N'La presencia de crepitantes bibasales en un paciente con disnea sugiere principalmente:');
DECLARE @p3 BIGINT = (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=N'¿Qué hallazgo auscultatorio es típico de una crisis asmática?');
DECLARE @p4 BIGINT = (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=N'¿En qué foco auscultatorio se escucha mejor el segundo ruido cardíaco (R2)?');
DECLARE @p5 BIGINT = (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=N'Los roncus de baja tonalidad indican secreciones en:');
DECLARE @p6 BIGINT = (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=N'Un soplo holosistólico en foco mitral irradiado a axila es típico de:');

-- T1: secuencial, María, KINE-401 (preguntas P1, P2, P3, P5)
IF NOT EXISTS (SELECT 1 FROM auris.test WHERE nombre=N'Ruidos pulmonares básicos')
BEGIN
    INSERT INTO auris.test (nombre, descripcion, orden_aleatorio, creado_por, curso_origen_id)
    VALUES (N'Ruidos pulmonares básicos',
            N'Test introductorio de auscultación pulmonar: ruidos normales y adventicios principales.',
            0, @mariaId, @c401);
    SET @t1 = SCOPE_IDENTITY();

    INSERT INTO auris.test_pregunta (test_id, pregunta_id, orden) VALUES
        (@t1, @p1, 1),
        (@t1, @p2, 2),
        (@t1, @p3, 3),
        (@t1, @p5, 4);
END;

-- T2: aleatorio, Ana, KINE-501 (preguntas P4, P6)
IF NOT EXISTS (SELECT 1 FROM auris.test WHERE nombre=N'Soplos cardíacos y focos auscultatorios')
BEGIN
    INSERT INTO auris.test (nombre, descripcion, orden_aleatorio, creado_por, curso_origen_id)
    VALUES (N'Soplos cardíacos y focos auscultatorios',
            N'Identificación de focos auscultatorios y patrones de soplos cardíacos comunes.',
            1, @anaId, @c501);
    SET @t2 = SCOPE_IDENTITY();

    INSERT INTO auris.test_pregunta (test_id, pregunta_id, orden) VALUES
        (@t2, @p4, 1),
        (@t2, @p6, 2);
END;

PRINT 'OK: 2 tests sembrados';
GO

/* =============================================================================
   15. SEED — Aplicaciones activas (para que el estudiante pueda probar)
   ============================================================================= */

DECLARE @mariaId BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='juan.perez@auris.local'); -- María eliminada: contenido demo reasignado a juan.perez
DECLARE @anaId   BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='juan.perez@auris.local'); -- Ana eliminada: contenido demo reasignado a juan.perez
DECLARE @c401 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-401');
DECLARE @c501 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-501');
DECLARE @t1 BIGINT = (SELECT TOP 1 test_id FROM auris.test WHERE nombre=N'Ruidos pulmonares básicos');
DECLARE @t2 BIGINT = (SELECT TOP 1 test_id FROM auris.test WHERE nombre=N'Soplos cardíacos y focos auscultatorios');

IF NOT EXISTS (SELECT 1 FROM auris.aplicacion_test WHERE test_id=@t1 AND curso_id=@c401)
    INSERT INTO auris.aplicacion_test (test_id, curso_id, profesor_id)
    VALUES (@t1, @c401, @mariaId);

IF NOT EXISTS (SELECT 1 FROM auris.aplicacion_test WHERE test_id=@t2 AND curso_id=@c501)
    INSERT INTO auris.aplicacion_test (test_id, curso_id, profesor_id)
    VALUES (@t2, @c501, @anaId);

PRINT 'OK: 2 aplicaciones activas creadas';
GO

DROP TABLE IF EXISTS #pregs;
GO

/* =============================================================================
   16. RESUMEN FINAL
   ============================================================================= */

PRINT '====================================================================';
PRINT 'Instalación completa. Conteos por tabla:';

SELECT 'usuario'             AS tabla, COUNT(*) AS filas FROM auris.usuario
UNION ALL SELECT 'usuario_rol',          COUNT(*) FROM auris.usuario_rol
UNION ALL SELECT 'curso',                COUNT(*) FROM auris.curso
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
PRINT 'Listo. El sistema está usable:';
PRINT '  - Panel (http://localhost:4200) → login con cualquier usuario.';
PRINT '  - App estudiante (http://localhost:4201) → ver 3 cursos, 2 tests.';
PRINT '====================================================================';
GO
