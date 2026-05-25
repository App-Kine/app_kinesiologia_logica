/* =============================================================================
   AurisDB – Dump lógico (esquema + datos) · App Kinesiología
   Versión:   1.1 (MVP)  ·  Generado: 12-05-2026
   Motor:     SQL Server 2019+ / Azure SQL Edge / Azure SQL Database
   Encoding:  UTF-8
   Plataforma: Cross-platform (macOS, Linux, Windows)
   -----------------------------------------------------------------------------
   QUÉ CONTIENE
   ============
     · CREATE DATABASE AurisDB
     · CREATE SCHEMA auris
     · 16 tablas con constraints, índices y CHECKs
     · 5 triggers de updated_at
     · 2 vistas de analítica docente
     · Seed inicial (roles + superadmin admin@auris.local / ChangeMe!2026)
     · Datos de prueba: 4 profesores, 5 cursos, 12 preguntas con alternativas,
       4 tests, 5 aplicaciones, 7 evaluaciones, 30+ respuestas individuales,
       2 invitaciones de profesor y log de auditoría.

   CÓMO EJECUTARLO  (script IDEMPOTENTE: se puede correr varias veces)
   ===============

   -- macOS / Linux  (Docker + Azure SQL Edge) ----------------------------
   docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=Martin131*" \
              -p 1433:1433 --name auris-mssql \
              -v auris-mssql-data:/var/opt/mssql \
              -d mcr.microsoft.com/azure-sql-edge:latest
   sleep 20
   docker cp AurisDB_dump.sql auris-mssql:/tmp/AurisDB_dump.sql
   docker run --rm -it --network container:auris-mssql \
              -v "$PWD":/scripts mcr.microsoft.com/mssql-tools \
              /opt/mssql-tools/bin/sqlcmd \
              -S localhost,1433 -U sa -P 'Martin131*' -C \
              -i /scripts/AurisDB_dump.sql

   -- Windows  (SSMS) -----------------------------------------------------
   Abrir SSMS → conectar a localhost → File → Open → AurisDB_dump.sql → F5

   -- Windows  (línea de comandos) ----------------------------------------
   sqlcmd -S localhost -U sa -P "Martin131*" -C -i AurisDB_dump.sql

   -- Azure Data Studio  (cualquier OS) -----------------------------------
   File → Open → AurisDB_dump.sql → conectar al server → ▶

   POSTREQUISITO
   =============
   Cambia la contraseña del superadmin antes de producción:
     UPDATE auris.usuario
        SET password_hash = 'NUEVO_BCRYPT_HASH'
      WHERE correo = 'admin@auris.local';
   ============================================================================= */

/* =============================================================================
   App Kinesiología (Auris) – Script SQL Server consolidado
   Versión: 1.1 (MVP, basado en SRS v2.0 del 12-05-2026)
   Motor:   Microsoft SQL Server 2019+
   -----------------------------------------------------------------------------
   Este archivo contiene TODO lo necesario para levantar la base relacional:
     1. CREATE DATABASE
     2. CREATE SCHEMA
     3. DDL completo (16 tablas)
     4. Índices y constraints
     5. Triggers de updated_at
     6. Vistas de analítica docente
     7. Seed inicial (roles + superadmin)

   Uso (sqlcmd):
       sqlcmd -S localhost -U sa -P 'YourStrong!Passw0rd' -i AurisDB_full.sql

   Uso (SQL Server Management Studio):
       Abrir este archivo y ejecutar (F5) con modo SQLCMD habilitado.

   IMPORTANTE: cambiar el password del superadmin antes de producción.
   ============================================================================= */

SET NOCOUNT ON;
GO

/* =============================================================================
   1. CREAR BASE DE DATOS
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

/* =============================================================================
   2. CREAR ESQUEMA LÓGICO
   ============================================================================= */
IF SCHEMA_ID(N'auris') IS NULL
BEGIN
    EXEC('CREATE SCHEMA auris');
    PRINT 'Esquema auris creado.';
END
GO

/* =============================================================================
   3. SEGURIDAD: roles, usuarios, refresh tokens, login, invitaciones
   ============================================================================= */

-- 3.1 Catálogo de roles
IF OBJECT_ID(N'auris.rol', N'U') IS NULL
CREATE TABLE auris.rol (
    rol_id          TINYINT          NOT NULL PRIMARY KEY,
    codigo          VARCHAR(20)      NOT NULL UNIQUE,    -- 'PROFESOR', 'SUPERADMIN'
    descripcion     NVARCHAR(120)    NOT NULL
);
GO

-- 3.2 Usuario interno (RF-52, RNF-10, RNF-11)
IF OBJECT_ID(N'auris.usuario', N'U') IS NULL
CREATE TABLE auris.usuario (
    usuario_id          BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    nombre              NVARCHAR(120)   NOT NULL,
    correo              NVARCHAR(254)   NOT NULL,
    password_hash       NVARCHAR(255)   NOT NULL,        -- bcrypt cost>=12 / argon2
    activo              BIT             NOT NULL CONSTRAINT DF_usuario_activo DEFAULT (1),
    created_at          DATETIME2(3)    NOT NULL CONSTRAINT DF_usuario_created DEFAULT (SYSUTCDATETIME()),
    updated_at          DATETIME2(3)    NOT NULL CONSTRAINT DF_usuario_updated DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_usuario_correo UNIQUE (correo),
    CONSTRAINT CK_usuario_correo_formato CHECK (correo LIKE '%_@_%._%')
);
GO

-- 3.3 Roles asignados (M:N). Soporta RF-56 (superadmin con privilegios de profesor).
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

-- 3.4 Refresh tokens (RNF-18)
IF OBJECT_ID(N'auris.refresh_token', N'U') IS NULL
CREATE TABLE auris.refresh_token (
    refresh_token_id    BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    usuario_id          BIGINT          NOT NULL,
    token_hash          CHAR(64)        NOT NULL,        -- SHA-256 hex
    emitido_en          DATETIME2(3)    NOT NULL CONSTRAINT DF_rt_emit DEFAULT (SYSUTCDATETIME()),
    expira_en           DATETIME2(3)    NOT NULL,        -- <= 7 días (RNF-17)
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

-- 3.5 Intentos de login (RF-60: bloqueo 15 min tras 5 fallos)
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

-- 3.6 Invitaciones de profesor (RF-77 a RF-83, RNF-12)
IF OBJECT_ID(N'auris.invitacion_profesor', N'U') IS NULL
CREATE TABLE auris.invitacion_profesor (
    invitacion_id        UNIQUEIDENTIFIER NOT NULL PRIMARY KEY
                             CONSTRAINT DF_inv_id DEFAULT (NEWID()),
    correo_destino       NVARCHAR(254)   NOT NULL,
    token_hash           CHAR(64)        NOT NULL UNIQUE,  -- SHA-256 hex
    estado               VARCHAR(20)     NOT NULL,         -- PENDIENTE|COMPLETADA|EXPIRADA|REENVIADA
    expira_en            DATETIME2(3)    NOT NULL,         -- <= 48h (RNF-12)
    creada_por           BIGINT          NOT NULL,
    creada_en            DATETIME2(3)    NOT NULL CONSTRAINT DF_inv_created DEFAULT (SYSUTCDATETIME()),
    completada_en        DATETIME2(3)    NULL,
    usuario_id_creado    BIGINT          NULL,
    invitacion_previa_id UNIQUEIDENTIFIER NULL,            -- RF-78 reenvío
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
   4. ACADÉMICO: cursos y asignaciones
   ============================================================================= */

-- 4.1 Curso (RF-74, RF-75)
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

-- 4.2 Asignación profesor-curso (RF-85)
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
   5. CONTENIDO: preguntas, alternativas, tests
   - Multimedia (audio/imagen) vive en MongoDB GridFS.
     Aquí solo se guarda el ObjectId hex (24 chars) como referencia.
   ============================================================================= */

-- 5.1 Pregunta (RF-62..RF-67)
IF OBJECT_ID(N'auris.pregunta', N'U') IS NULL
CREATE TABLE auris.pregunta (
    pregunta_id         BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    enunciado           NVARCHAR(2000)  NOT NULL,
    explicacion_clinica NVARCHAR(4000)  NOT NULL,
    audio_grid_id       VARCHAR(24)     NULL,
    imagen_grid_id      VARCHAR(24)     NULL,
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
    CONSTRAINT CK_preg_gridid_imagen CHECK (imagen_grid_id IS NULL OR LEN(imagen_grid_id) = 24)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_preg_curso' AND object_id = OBJECT_ID('auris.pregunta'))
    CREATE INDEX IX_preg_curso ON auris.pregunta(curso_origen_id) WHERE activo = 1;
GO

-- 5.2 Alternativa: 2..5 por pregunta (RF-22), exactamente 1 correcta (RF-66)
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

-- 5.3 Test (RF-15 orden, RF-69)
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

-- 5.4 Composición test-pregunta (RF-69, RF-15)
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
   6. APLICACIÓN DE TEST – RF-71, RF-72, RF-88 a RF-93
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
   7. EJECUCIÓN DEL ESTUDIANTE: evaluaciones y respuestas
   ============================================================================= */

-- 7.1 Evaluación (RF-11, RF-13, RF-44, RNF-08, RNF-09, RNF-29)
IF OBJECT_ID(N'auris.evaluacion', N'U') IS NULL
CREATE TABLE auris.evaluacion (
    evaluacion_id       BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    evaluacion_uuid     UNIQUEIDENTIFIER NOT NULL UNIQUE
                            CONSTRAINT DF_eval_uuid DEFAULT (NEWID()),
    aplicacion_id       BIGINT          NOT NULL,
    modalidad           VARCHAR(15)     NOT NULL,        -- ANONIMA | IDENTIFICADA
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
    -- NUNCA almacenar IP/huella en anónimas (RNF-29)
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

-- 7.2 Respuesta por pregunta (RF-31, RF-32, RF-35, RF-44)
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
    resultado               VARCHAR(20)     NULL,        -- CORRECTA_INT1 | CORRECTA_INT2 | INCORRECTA
    respondida_en           DATETIME2(3)    NOT NULL CONSTRAINT DF_resp_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_resp_eval     FOREIGN KEY (evaluacion_id)           REFERENCES auris.evaluacion(evaluacion_id) ON DELETE CASCADE,
    CONSTRAINT FK_resp_pregunta FOREIGN KEY (pregunta_id)             REFERENCES auris.pregunta(pregunta_id),
    CONSTRAINT FK_resp_alt1     FOREIGN KEY (alternativa_intento1_id) REFERENCES auris.alternativa(alternativa_id),
    CONSTRAINT FK_resp_alt2     FOREIGN KEY (alternativa_intento2_id) REFERENCES auris.alternativa(alternativa_id),
    CONSTRAINT UQ_resp_eval_preg UNIQUE (evaluacion_id, pregunta_id),
    CONSTRAINT CK_resp_intentos CHECK (intentos_usados BETWEEN 0 AND 2),
    CONSTRAINT CK_resp_resultado CHECK (resultado IS NULL OR resultado IN ('CORRECTA_INT1','CORRECTA_INT2','INCORRECTA'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_resp_pregunta_resultado' AND object_id = OBJECT_ID('auris.respuesta_pregunta'))
    CREATE INDEX IX_resp_pregunta_resultado ON auris.respuesta_pregunta(pregunta_id, resultado);
GO

/* =============================================================================
   8. AUDITORÍA (RNF-25)
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
   9. TRIGGERS de updated_at
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
  10. VISTAS de apoyo para analítica docente (RF-94 a RF-104)
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
  11. SEED INICIAL (roles + superadmin)
       Password del admin: ChangeMe!2026  (bcrypt cost 12)
       CAMBIAR EN PRODUCCIÓN.
   ============================================================================= */

SET XACT_ABORT ON;
BEGIN TRAN;

-- 11.1 Roles
IF NOT EXISTS (SELECT 1 FROM auris.rol WHERE rol_id = 1)
    INSERT INTO auris.rol (rol_id, codigo, descripcion) VALUES
        (1, 'SUPERADMIN', N'Administrador del sistema. Privilegios máximos.'),
        (2, 'PROFESOR',   N'Crea contenido, gestiona tests y consulta analítica de sus cursos.');

-- 11.2 Superadmin inicial (con rol PROFESOR adicional para demostrar RF-56)
IF NOT EXISTS (SELECT 1 FROM auris.usuario WHERE correo = 'admin@auris.local')
BEGIN
    DECLARE @adminId BIGINT;
    INSERT INTO auris.usuario (nombre, correo, password_hash, activo)
    VALUES (N'Administrador Auris',
            'admin@auris.local',
            '$2b$12$dv98sIkhzuXJl9r9RysA3eKOLMlcDBHYCTnYSnsOJQ7ll7lnvkrWO',
            1);
    SET @adminId = SCOPE_IDENTITY();
    INSERT INTO auris.usuario_rol (usuario_id, rol_id) VALUES (@adminId, 1);
END;

-- 11.3 Superadmin "puro" para demo de RF-55 (solo SUPERADMIN, sin PROFESOR)
--      Password: AdminPuro!2026
IF NOT EXISTS (SELECT 1 FROM auris.usuario WHERE correo = 'superadmin@auris.local')
BEGIN
    DECLARE @superId BIGINT;
    INSERT INTO auris.usuario (nombre, correo, password_hash, activo)
    VALUES (N'Super Admin Demo',
            'superadmin@auris.local',
            '$2b$12$hyFw8oHxsD3sLtsfSVtR1uNN7cYEGXG4ilwRoxxv8ZNCGbO3TTptC',
            1);
    SET @superId = SCOPE_IDENTITY();
    INSERT INTO auris.usuario_rol (usuario_id, rol_id) VALUES (@superId, 1);
END;

COMMIT TRAN;
GO

/* =============================================================================
  12. RESUMEN AL FINAL
   ============================================================================= */

PRINT '====================================================================';
PRINT 'AurisDB lista. Tablas creadas en el esquema auris:';
SELECT TABLE_SCHEMA, TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'auris' AND TABLE_TYPE = 'BASE TABLE'
ORDER BY TABLE_NAME;
GO

PRINT 'Vistas:';
SELECT TABLE_SCHEMA, TABLE_NAME
FROM INFORMATION_SCHEMA.VIEWS
WHERE TABLE_SCHEMA = 'auris'
ORDER BY TABLE_NAME;
GO

PRINT 'Usuarios iniciales:';
SELECT u.usuario_id, u.nombre, u.correo, r.codigo AS rol
FROM auris.usuario u
JOIN auris.usuario_rol ur ON ur.usuario_id = u.usuario_id
JOIN auris.rol r ON r.rol_id = ur.rol_id;
GO

PRINT '====================================================================';
PRINT 'Listo. Cambia la contraseña del admin antes de producción.';
GO


/* ===== INICIO DE POBLACIÓN DE DATOS ===== */

   App Kinesiología (Auris) – Datos de prueba (populate)
   Requiere: AurisDB_full.sql ya ejecutado.
   Idempotente: usa IF NOT EXISTS y lookups por código/correo único.
   -----------------------------------------------------------------------------
   Volumen poblado:
     · 5 usuarios internos (1 superadmin existente + 4 profesores)
     · 4 cursos activos + 1 inactivo
     · 6 asignaciones profesor↔curso
     · 12 preguntas con sus alternativas
     · 4 tests
     · Composiciones test↔pregunta
     · 5 aplicaciones de test
     · ~10 evaluaciones (mezcla anónimas/identificadas)
     · ~30 respuestas individuales
     · 6 entradas de auditoría
     · 1 invitación pendiente y 1 expirada
   -----------------------------------------------------------------------------
   IMPORTANTE:
     · Los password_hash son strings de ejemplo con formato bcrypt válido.
       Para autenticar realmente, regenéralos en backend.
     · El audio_grid_id e imagen_grid_id son ObjectIds hex de 24 chars
       de ejemplo; en producción apuntan a archivos reales en GridFS.
   ============================================================================= */

USE AurisDB;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

BEGIN TRAN;

/* =============================================================================
   1) USUARIOS (4 profesores; admin ya existe del seed)
   ============================================================================= */

DECLARE @hashEjemplo NVARCHAR(255) = '$2b$12$dv98sIkhzuXJl9r9RysA3eKOLMlcDBHYCTnYSnsOJQ7ll7lnvkrWO';
-- password de ejemplo: ChangeMe!2026 (todos los profesores comparten en demo)

IF NOT EXISTS (SELECT 1 FROM auris.usuario WHERE correo='maria.gonzalez@auris.local')
    INSERT INTO auris.usuario (nombre, correo, password_hash, activo) VALUES
        (N'María González',  'maria.gonzalez@auris.local',  @hashEjemplo, 1);

IF NOT EXISTS (SELECT 1 FROM auris.usuario WHERE correo='juan.perez@auris.local')
    INSERT INTO auris.usuario (nombre, correo, password_hash, activo) VALUES
        (N'Juan Pérez',      'juan.perez@auris.local',      @hashEjemplo, 1);

IF NOT EXISTS (SELECT 1 FROM auris.usuario WHERE correo='ana.rodriguez@auris.local')
    INSERT INTO auris.usuario (nombre, correo, password_hash, activo) VALUES
        (N'Ana Rodríguez',   'ana.rodriguez@auris.local',   @hashEjemplo, 1);

IF NOT EXISTS (SELECT 1 FROM auris.usuario WHERE correo='carlos.munoz@auris.local')
    INSERT INTO auris.usuario (nombre, correo, password_hash, activo) VALUES
        (N'Carlos Muñoz',    'carlos.munoz@auris.local',    @hashEjemplo, 1);

-- Asignar rol PROFESOR (rol_id=2) a los 4 nuevos
INSERT INTO auris.usuario_rol (usuario_id, rol_id)
SELECT u.usuario_id, 2
FROM auris.usuario u
WHERE u.correo IN ('maria.gonzalez@auris.local','juan.perez@auris.local',
                   'ana.rodriguez@auris.local','carlos.munoz@auris.local')
  AND NOT EXISTS (SELECT 1 FROM auris.usuario_rol ur WHERE ur.usuario_id=u.usuario_id AND ur.rol_id=2);

-- El superadmin admin@auris.local también recibe rol PROFESOR (RF-56)
INSERT INTO auris.usuario_rol (usuario_id, rol_id)
SELECT u.usuario_id, 2
FROM auris.usuario u
WHERE u.correo='admin@auris.local'
  AND NOT EXISTS (SELECT 1 FROM auris.usuario_rol ur WHERE ur.usuario_id=u.usuario_id AND ur.rol_id=2);

/* =============================================================================
   2) CURSOS
   ============================================================================= */

DECLARE @adminId BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='admin@auris.local');

IF NOT EXISTS (SELECT 1 FROM auris.curso WHERE codigo='KINE-401')
    INSERT INTO auris.curso (codigo, nombre, descripcion, activo, creado_por) VALUES
        ('KINE-401', N'Kinesiología Cardiorrespiratoria I',
         N'Bases anatómicas y fisiológicas del sistema cardiorrespiratorio. Auscultación inicial.', 1, @adminId);

IF NOT EXISTS (SELECT 1 FROM auris.curso WHERE codigo='KINE-402')
    INSERT INTO auris.curso (codigo, nombre, descripcion, activo, creado_por) VALUES
        ('KINE-402', N'Kinesiología Cardiorrespiratoria II',
         N'Evaluación clínica avanzada y patrones de ruidos adventicios.', 1, @adminId);

IF NOT EXISTS (SELECT 1 FROM auris.curso WHERE codigo='KINE-403')
    INSERT INTO auris.curso (codigo, nombre, descripcion, activo, creado_por) VALUES
        ('KINE-403', N'Semiología del Tórax',
         N'Inspección, palpación, percusión y auscultación torácica.', 1, @adminId);

IF NOT EXISTS (SELECT 1 FROM auris.curso WHERE codigo='KINE-501')
    INSERT INTO auris.curso (codigo, nombre, descripcion, activo, creado_por) VALUES
        ('KINE-501', N'Auscultación Clínica Avanzada',
         N'Diferenciación de ruidos pulmonares y cardíacos en pacientes complejos.', 1, @adminId);

IF NOT EXISTS (SELECT 1 FROM auris.curso WHERE codigo='KINE-301')
    INSERT INTO auris.curso (codigo, nombre, descripcion, activo, creado_por) VALUES
        ('KINE-301', N'Introducción a la Auscultación (archivado)',
         N'Curso introductorio descontinuado en 2025.', 0, @adminId);

/* =============================================================================
   3) ASIGNACIONES profesor ↔ curso
   ============================================================================= */

;WITH asignaciones AS (
    SELECT correo_prof, codigo_curso
    FROM (VALUES
        ('maria.gonzalez@auris.local',  'KINE-401'),
        ('maria.gonzalez@auris.local',  'KINE-402'),
        ('juan.perez@auris.local',      'KINE-403'),
        ('ana.rodriguez@auris.local',   'KINE-403'),
        ('ana.rodriguez@auris.local',   'KINE-501'),
        ('carlos.munoz@auris.local',    'KINE-401'),
        ('carlos.munoz@auris.local',    'KINE-501')
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

/* =============================================================================
   4) PREGUNTAS (12) + ALTERNATIVAS
   - Las explicaciones clínicas son breves y didácticas.
   - audio_grid_id / imagen_grid_id son referencias de ejemplo a GridFS.
   ============================================================================= */

DECLARE @mariaId    BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='maria.gonzalez@auris.local');
DECLARE @juanId     BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='juan.perez@auris.local');
DECLARE @anaId      BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='ana.rodriguez@auris.local');
DECLARE @carlosId   BIGINT = (SELECT usuario_id FROM auris.usuario WHERE correo='carlos.munoz@auris.local');

DECLARE @c401 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-401');
DECLARE @c402 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-402');
DECLARE @c403 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-403');
DECLARE @c501 BIGINT = (SELECT curso_id FROM auris.curso WHERE codigo='KINE-501');

-- Tabla temporal para mapear preguntas por una "clave de demo"
IF OBJECT_ID('tempdb..#pregs') IS NOT NULL DROP TABLE #pregs;
CREATE TABLE #pregs (clave VARCHAR(40) PRIMARY KEY, pregunta_id BIGINT);

-- Helper inline: solo inserta si no existe (por unicidad del enunciado)
DECLARE @e NVARCHAR(2000), @x NVARCHAR(4000), @id BIGINT;

-- P1
SET @e = N'¿Qué sonido pulmonar normal se ausculta en los campos pulmonares periféricos?';
SET @x = N'El murmullo vesicular es el ruido normal generado por el flujo aéreo en bronquíolos y alvéolos, audible en periferia.';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, audio_grid_id, creado_por, curso_origen_id)
    VALUES (@e, @x, '64a1f0b3c8d4e5f601020301', @mariaId, @c401);
    SET @id = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@id, N'Murmullo vesicular', 1, 1),
        (@id, N'Soplo tubárico',     0, 2),
        (@id, N'Sibilancias',        0, 3),
        (@id, N'Roncus',             0, 4);
    INSERT INTO #pregs VALUES ('P1', @id);
END ELSE INSERT INTO #pregs SELECT 'P1', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

-- P2
SET @e = N'La presencia de crepitantes bibasales en un paciente con disnea sugiere principalmente:';
SET @x = N'Los crepitantes finos bibasales son característicos del edema intersticial por insuficiencia cardíaca congestiva.';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, audio_grid_id, imagen_grid_id, creado_por, curso_origen_id)
    VALUES (@e, @x, '64a1f0b3c8d4e5f601020302', '64a1f0b3c8d4e5f601020402', @mariaId, @c402);
    SET @id = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@id, N'Asma bronquial',                      0, 1),
        (@id, N'Insuficiencia cardíaca congestiva',   1, 2),
        (@id, N'Neumotórax',                          0, 3),
        (@id, N'Enfisema',                            0, 4);
    INSERT INTO #pregs VALUES ('P2', @id);
END ELSE INSERT INTO #pregs SELECT 'P2', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

-- P3
SET @e = N'¿Cuál es la causa más común de sibilancias espiratorias difusas?';
SET @x = N'Las sibilancias espiratorias difusas reflejan obstrucción de vía aérea pequeña: asma o EPOC son las causas más frecuentes.';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, audio_grid_id, creado_por, curso_origen_id)
    VALUES (@e, @x, '64a1f0b3c8d4e5f601020303', @mariaId, @c401);
    SET @id = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@id, N'Asma bronquial / EPOC',     1, 1),
        (@id, N'Neumonía bacteriana',       0, 2),
        (@id, N'Tromboembolia pulmonar',    0, 3),
        (@id, N'Derrame pleural',           0, 4);
    INSERT INTO #pregs VALUES ('P3', @id);
END ELSE INSERT INTO #pregs SELECT 'P3', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

-- P4
SET @e = N'El soplo tubárico se ausculta característicamente en:';
SET @x = N'El soplo tubárico aparece cuando el parénquima pulmonar consolidado transmite los ruidos bronquiales (ej.: neumonía).';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, audio_grid_id, creado_por, curso_origen_id)
    VALUES (@e, @x, '64a1f0b3c8d4e5f601020304', @juanId, @c403);
    SET @id = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@id, N'Asma',                                 0, 1),
        (@id, N'Condensación pulmonar (neumonía)',     1, 2),
        (@id, N'Neumotórax',                           0, 3),
        (@id, N'Pleuritis',                            0, 4);
    INSERT INTO #pregs VALUES ('P4', @id);
END ELSE INSERT INTO #pregs SELECT 'P4', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

-- P5
SET @e = N'¿Qué hallazgo auscultatorio es característico del neumotórax?';
SET @x = N'En el neumotórax el aire en la cavidad pleural elimina la transmisión del murmullo vesicular en el hemitórax afectado.';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, audio_grid_id, imagen_grid_id, creado_por, curso_origen_id)
    VALUES (@e, @x, '64a1f0b3c8d4e5f601020305', '64a1f0b3c8d4e5f601020405', @juanId, @c403);
    SET @id = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@id, N'Aumento del murmullo vesicular',                0, 1),
        (@id, N'Abolición o disminución del murmullo vesicular',1, 2),
        (@id, N'Crepitantes finos',                              0, 3),
        (@id, N'Roncus difusos',                                 0, 4);
    INSERT INTO #pregs VALUES ('P5', @id);
END ELSE INSERT INTO #pregs SELECT 'P5', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

-- P6
SET @e = N'Los roncus se caracterizan por ser sonidos:';
SET @x = N'Los roncus son ruidos continuos graves, generados por secreciones en vías aéreas grandes; suelen modificarse con la tos.';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, audio_grid_id, creado_por, curso_origen_id)
    VALUES (@e, @x, '64a1f0b3c8d4e5f601020306', @anaId, @c501);
    SET @id = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@id, N'Agudos espiratorios',                                 0, 1),
        (@id, N'Graves continuos por secreciones bronquiales',        1, 2),
        (@id, N'Discontinuos al final de la inspiración',             0, 3),
        (@id, N'Solo audibles en niños',                              0, 4);
    INSERT INTO #pregs VALUES ('P6', @id);
END ELSE INSERT INTO #pregs SELECT 'P6', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

-- P7
SET @e = N'El estridor inspiratorio sugiere obstrucción a nivel de:';
SET @x = N'El estridor es un ruido inspiratorio agudo, indicativo de obstrucción de vía aérea superior (laringe, tráquea extratorácica).';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, audio_grid_id, creado_por, curso_origen_id)
    VALUES (@e, @x, '64a1f0b3c8d4e5f601020307', @anaId, @c501);
    SET @id = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@id, N'Bronquios pequeños',          0, 1),
        (@id, N'Vía aérea superior / laringe',1, 2),
        (@id, N'Alvéolos',                    0, 3),
        (@id, N'Pleura',                      0, 4);
    INSERT INTO #pregs VALUES ('P7', @id);
END ELSE INSERT INTO #pregs SELECT 'P7', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

-- P8
SET @e = N'El frote pleural se caracteriza por:';
SET @x = N'El frote pleural es un sonido áspero, "de cuero", audible en inspiración y espiración. No se modifica con la tos.';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, audio_grid_id, creado_por, curso_origen_id)
    VALUES (@e, @x, '64a1f0b3c8d4e5f601020308', @juanId, @c403);
    SET @id = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@id, N'Sonido agudo y musical',                          0, 1),
        (@id, N'Sonido áspero audible en inspiración y espiración',1, 2),
        (@id, N'Desaparece con la tos',                            0, 3),
        (@id, N'Disminuye con respiración profunda',               0, 4);
    INSERT INTO #pregs VALUES ('P8', @id);
END ELSE INSERT INTO #pregs SELECT 'P8', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

-- P9
SET @e = N'¿Cuál es el foco aórtico de auscultación cardíaca?';
SET @x = N'El foco aórtico se localiza en el 2° espacio intercostal derecho, borde paraesternal.';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, imagen_grid_id, creado_por, curso_origen_id)
    VALUES (@e, @x, '64a1f0b3c8d4e5f601020409', @carlosId, @c501);
    SET @id = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@id, N'5° EIC izquierdo, línea medioclavicular',     0, 1),
        (@id, N'2° EIC derecho, borde paraesternal',          1, 2),
        (@id, N'4° EIC izquierdo, borde paraesternal',        0, 3),
        (@id, N'2° EIC izquierdo, borde paraesternal',        0, 4);
    INSERT INTO #pregs VALUES ('P9', @id);
END ELSE INSERT INTO #pregs SELECT 'P9', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

-- P10
SET @e = N'Los crepitantes finos teleinspiratorios son típicos de:';
SET @x = N'Los crepitantes finos al final de la inspiración aparecen en fibrosis pulmonar y edema agudo de pulmón.';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, audio_grid_id, creado_por, curso_origen_id)
    VALUES (@e, @x, '64a1f0b3c8d4e5f60102030a', @carlosId, @c501);
    SET @id = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@id, N'Bronquitis crónica',              0, 1),
        (@id, N'Edema pulmonar / fibrosis',       1, 2),
        (@id, N'Asma',                            0, 3),
        (@id, N'Derrame pleural',                 0, 4);
    INSERT INTO #pregs VALUES ('P10', @id);
END ELSE INSERT INTO #pregs SELECT 'P10', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

-- P11
SET @e = N'La auscultación pulmonar es una técnica diagnóstica:';
SET @x = N'La auscultación es no invasiva, de bajo costo y operador-dependiente; es parte central del examen físico respiratorio.';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, creado_por, curso_origen_id)
    VALUES (@e, @x, @mariaId, @c401);
    SET @id = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@id, N'Invasiva',                          0, 1),
        (@id, N'No invasiva',                       1, 2),
        (@id, N'Que requiere anestesia',            0, 3),
        (@id, N'Solo aplicable a pacientes adultos',0, 4);
    INSERT INTO #pregs VALUES ('P11', @id);
END ELSE INSERT INTO #pregs SELECT 'P11', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

-- P12
SET @e = N'En un paciente con derrame pleural masivo, la auscultación típica del hemitórax afectado muestra:';
SET @x = N'En el derrame pleural masivo el murmullo vesicular se encuentra disminuido o abolido en la base; puede haber egofonía sobre el límite superior.';
IF NOT EXISTS (SELECT 1 FROM auris.pregunta WHERE enunciado=@e)
BEGIN
    INSERT INTO auris.pregunta (enunciado, explicacion_clinica, audio_grid_id, imagen_grid_id, creado_por, curso_origen_id)
    VALUES (@e, @x, '64a1f0b3c8d4e5f60102030c', '64a1f0b3c8d4e5f60102040c', @anaId, @c403);
    SET @id = SCOPE_IDENTITY();
    INSERT INTO auris.alternativa (pregunta_id, texto, es_correcta, orden) VALUES
        (@id, N'Murmullo vesicular conservado',     0, 1),
        (@id, N'Murmullo vesicular disminuido o abolido en la base', 1, 2),
        (@id, N'Sibilancias generalizadas',         0, 3),
        (@id, N'Estridor inspiratorio',             0, 4);
    INSERT INTO #pregs VALUES ('P12', @id);
END ELSE INSERT INTO #pregs SELECT 'P12', (SELECT pregunta_id FROM auris.pregunta WHERE enunciado=@e);

/* =============================================================================
   5) TESTS
   ============================================================================= */

DECLARE @nombreTest NVARCHAR(200), @testId BIGINT;

IF OBJECT_ID('tempdb..#tests') IS NOT NULL DROP TABLE #tests;
CREATE TABLE #tests (clave VARCHAR(20) PRIMARY KEY, test_id BIGINT);

-- T1: secuencial básico
SET @nombreTest = N'Auscultación pulmonar básica';
IF NOT EXISTS (SELECT 1 FROM auris.test WHERE nombre=@nombreTest)
BEGIN
    INSERT INTO auris.test (nombre, descripcion, orden_aleatorio, creado_por, curso_origen_id)
    VALUES (@nombreTest, N'Test introductorio: sonidos normales y adventicios.', 0, @mariaId, @c401);
    SET @testId = SCOPE_IDENTITY();
    INSERT INTO #tests VALUES ('T1', @testId);
    -- 6 preguntas en orden
    INSERT INTO auris.test_pregunta (test_id, pregunta_id, orden)
    SELECT @testId, p.pregunta_id,
           ROW_NUMBER() OVER(ORDER BY CASE p.clave WHEN 'P1' THEN 1 WHEN 'P3' THEN 2
                                          WHEN 'P6' THEN 3 WHEN 'P7' THEN 4
                                          WHEN 'P10' THEN 5 WHEN 'P11' THEN 6 END)
    FROM #pregs p WHERE p.clave IN ('P1','P3','P6','P7','P10','P11');
END ELSE INSERT INTO #tests SELECT 'T1', test_id FROM auris.test WHERE nombre=@nombreTest;

-- T2: aleatorio, ruidos adventicios
SET @nombreTest = N'Ruidos adventicios – diagnóstico diferencial';
IF NOT EXISTS (SELECT 1 FROM auris.test WHERE nombre=@nombreTest)
BEGIN
    INSERT INTO auris.test (nombre, descripcion, orden_aleatorio, creado_por, curso_origen_id)
    VALUES (@nombreTest, N'5 preguntas en orden aleatorio sobre ruidos adventicios.', 1, @anaId, @c501);
    SET @testId = SCOPE_IDENTITY();
    INSERT INTO #tests VALUES ('T2', @testId);
    INSERT INTO auris.test_pregunta (test_id, pregunta_id, orden)
    SELECT @testId, p.pregunta_id,
           ROW_NUMBER() OVER(ORDER BY p.clave)
    FROM #pregs p WHERE p.clave IN ('P2','P3','P6','P7','P10');
END ELSE INSERT INTO #tests SELECT 'T2', test_id FROM auris.test WHERE nombre=@nombreTest;

-- T3: semiología completa
SET @nombreTest = N'Semiología torácica – examen integral';
IF NOT EXISTS (SELECT 1 FROM auris.test WHERE nombre=@nombreTest)
BEGIN
    INSERT INTO auris.test (nombre, descripcion, orden_aleatorio, creado_por, curso_origen_id)
    VALUES (@nombreTest, N'10 preguntas integradoras de semiología.', 0, @juanId, @c403);
    SET @testId = SCOPE_IDENTITY();
    INSERT INTO #tests VALUES ('T3', @testId);
    INSERT INTO auris.test_pregunta (test_id, pregunta_id, orden)
    SELECT @testId, p.pregunta_id,
           ROW_NUMBER() OVER(ORDER BY p.clave)
    FROM #pregs p WHERE p.clave IN ('P1','P2','P4','P5','P6','P8','P9','P10','P11','P12');
END ELSE INSERT INTO #tests SELECT 'T3', test_id FROM auris.test WHERE nombre=@nombreTest;

-- T4: quick check
SET @nombreTest = N'Quick check – normal vs anormal';
IF NOT EXISTS (SELECT 1 FROM auris.test WHERE nombre=@nombreTest)
BEGIN
    INSERT INTO auris.test (nombre, descripcion, orden_aleatorio, creado_por, curso_origen_id)
    VALUES (@nombreTest, N'4 preguntas rápidas: sonido normal vs adventicio.', 1, @carlosId, @c501);
    SET @testId = SCOPE_IDENTITY();
    INSERT INTO #tests VALUES ('T4', @testId);
    INSERT INTO auris.test_pregunta (test_id, pregunta_id, orden)
    SELECT @testId, p.pregunta_id,
           ROW_NUMBER() OVER(ORDER BY p.clave)
    FROM #pregs p WHERE p.clave IN ('P1','P5','P9','P11');
END ELSE INSERT INTO #tests SELECT 'T4', test_id FROM auris.test WHERE nombre=@nombreTest;

/* =============================================================================
   6) APLICACIONES DE TEST (un mismo test puede ir a varios cursos: RF-72)
   ============================================================================= */

DECLARE @t1 BIGINT = (SELECT test_id FROM #tests WHERE clave='T1');
DECLARE @t2 BIGINT = (SELECT test_id FROM #tests WHERE clave='T2');
DECLARE @t3 BIGINT = (SELECT test_id FROM #tests WHERE clave='T3');
DECLARE @t4 BIGINT = (SELECT test_id FROM #tests WHERE clave='T4');

IF NOT EXISTS (SELECT 1 FROM auris.aplicacion_test WHERE test_id=@t1 AND curso_id=@c401)
    INSERT INTO auris.aplicacion_test (test_id, curso_id, profesor_id, activo) VALUES (@t1, @c401, @mariaId,  1);

IF NOT EXISTS (SELECT 1 FROM auris.aplicacion_test WHERE test_id=@t1 AND curso_id=@c402)
    INSERT INTO auris.aplicacion_test (test_id, curso_id, profesor_id, activo) VALUES (@t1, @c402, @mariaId,  1);

IF NOT EXISTS (SELECT 1 FROM auris.aplicacion_test WHERE test_id=@t2 AND curso_id=@c501)
    INSERT INTO auris.aplicacion_test (test_id, curso_id, profesor_id, activo) VALUES (@t2, @c501, @anaId,    1);

IF NOT EXISTS (SELECT 1 FROM auris.aplicacion_test WHERE test_id=@t3 AND curso_id=@c403)
    INSERT INTO auris.aplicacion_test (test_id, curso_id, profesor_id, activo) VALUES (@t3, @c403, @juanId,   1);

-- T4 desactivado para demostrar visibilidad (RF-91, RF-92)
IF NOT EXISTS (SELECT 1 FROM auris.aplicacion_test WHERE test_id=@t4 AND curso_id=@c501)
    INSERT INTO auris.aplicacion_test (test_id, curso_id, profesor_id, activo) VALUES (@t4, @c501, @carlosId, 0);

/* =============================================================================
   7) INVITACIONES de profesor (1 pendiente, 1 expirada)
   ============================================================================= */

IF NOT EXISTS (SELECT 1 FROM auris.invitacion_profesor WHERE correo_destino='nuevo.profesor@auris.local')
    INSERT INTO auris.invitacion_profesor (correo_destino, token_hash, estado, expira_en, creada_por)
    VALUES ('nuevo.profesor@auris.local',
            REPLICATE('a',64),
            'PENDIENTE',
            DATEADD(HOUR, 24, SYSUTCDATETIME()),
            @adminId);

IF NOT EXISTS (SELECT 1 FROM auris.invitacion_profesor WHERE correo_destino='profesor.expirado@auris.local')
    INSERT INTO auris.invitacion_profesor (correo_destino, token_hash, estado, expira_en, creada_por)
    VALUES ('profesor.expirado@auris.local',
            REPLICATE('b',64),
            'EXPIRADA',
            DATEADD(HOUR, -1, SYSUTCDATETIME()),
            @adminId);

/* =============================================================================
   8) EVALUACIONES + RESPUESTAS (datos de prueba para analítica)
   ============================================================================= */

DECLARE @apl_t1_c401 BIGINT = (SELECT aplicacion_id FROM auris.aplicacion_test WHERE test_id=@t1 AND curso_id=@c401);
DECLARE @apl_t1_c402 BIGINT = (SELECT aplicacion_id FROM auris.aplicacion_test WHERE test_id=@t1 AND curso_id=@c402);
DECLARE @apl_t2_c501 BIGINT = (SELECT aplicacion_id FROM auris.aplicacion_test WHERE test_id=@t2 AND curso_id=@c501);
DECLARE @apl_t3_c403 BIGINT = (SELECT aplicacion_id FROM auris.aplicacion_test WHERE test_id=@t3 AND curso_id=@c403);

DECLARE @evalId BIGINT;

-- Helper: insertar una respuesta correcta al primer intento
-- Para evitar repetir, inline. Cada bloque crea una evaluación + sus respuestas.

----------------------------------------------------------------------------
-- E1: Estudiante IDENTIFICADO en T1/KINE-401, 6 preguntas, todas al primer intento
----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM auris.evaluacion WHERE aplicacion_id=@apl_t1_c401 AND correo_estudiante='lucia.fernandez@uchile.cl')
BEGIN
    INSERT INTO auris.evaluacion (aplicacion_id, modalidad, correo_estudiante, estado,
                                  iniciada_en, finalizada_en,
                                  total_preguntas, aciertos_primer, aciertos_segundo, incorrectas,
                                  porcentaje_global, informe_enviado_en)
    VALUES (@apl_t1_c401, 'IDENTIFICADA', 'lucia.fernandez@uchile.cl', 'FINALIZADA',
            DATEADD(HOUR, -50, SYSUTCDATETIME()), DATEADD(HOUR, -49, SYSUTCDATETIME()),
            6, 5, 0, 1, 83.33, DATEADD(HOUR, -49, SYSUTCDATETIME()));
    SET @evalId = SCOPE_IDENTITY();
    -- Respuestas: 5 correctas en intento 1, 1 incorrecta total
    INSERT INTO auris.respuesta_pregunta
        (evaluacion_id, pregunta_id, orden_presentacion,
         alternativa_intento1_id, correcta_intento1,
         alternativa_intento2_id, correcta_intento2,
         intentos_usados, resultado)
    SELECT @evalId, p.pregunta_id, ROW_NUMBER() OVER(ORDER BY p.clave),
           (SELECT TOP 1 alternativa_id FROM auris.alternativa
            WHERE pregunta_id=p.pregunta_id AND es_correcta=1),
           1, NULL, NULL, 1, 'CORRECTA_INT1'
    FROM #pregs p WHERE p.clave IN ('P1','P3','P6','P7','P10');
    -- P11 incorrecta tras 2 intentos
    INSERT INTO auris.respuesta_pregunta
        (evaluacion_id, pregunta_id, orden_presentacion,
         alternativa_intento1_id, correcta_intento1,
         alternativa_intento2_id, correcta_intento2,
         intentos_usados, resultado)
    SELECT @evalId, p.pregunta_id, 6,
           (SELECT TOP 1 alternativa_id FROM auris.alternativa
            WHERE pregunta_id=p.pregunta_id AND es_correcta=0 ORDER BY orden), 0,
           (SELECT TOP 1 alternativa_id FROM auris.alternativa
            WHERE pregunta_id=p.pregunta_id AND es_correcta=0 ORDER BY orden DESC), 0,
           2, 'INCORRECTA'
    FROM #pregs p WHERE p.clave='P11';
END;

----------------------------------------------------------------------------
-- E2: Estudiante ANÓNIMO en T1/KINE-401, 6 preguntas, perfecto
----------------------------------------------------------------------------
IF (SELECT COUNT(*) FROM auris.evaluacion WHERE aplicacion_id=@apl_t1_c401 AND modalidad='ANONIMA') < 1
BEGIN
    INSERT INTO auris.evaluacion (aplicacion_id, modalidad, correo_estudiante, estado,
                                  iniciada_en, finalizada_en,
                                  total_preguntas, aciertos_primer, aciertos_segundo, incorrectas,
                                  porcentaje_global)
    VALUES (@apl_t1_c401, 'ANONIMA', NULL, 'FINALIZADA',
            DATEADD(HOUR, -30, SYSUTCDATETIME()), DATEADD(HOUR, -29, SYSUTCDATETIME()),
            6, 6, 0, 0, 100.00);
    SET @evalId = SCOPE_IDENTITY();
    INSERT INTO auris.respuesta_pregunta
        (evaluacion_id, pregunta_id, orden_presentacion,
         alternativa_intento1_id, correcta_intento1, intentos_usados, resultado)
    SELECT @evalId, p.pregunta_id, ROW_NUMBER() OVER(ORDER BY p.clave),
           (SELECT TOP 1 alternativa_id FROM auris.alternativa
            WHERE pregunta_id=p.pregunta_id AND es_correcta=1),
           1, 1, 'CORRECTA_INT1'
    FROM #pregs p WHERE p.clave IN ('P1','P3','P6','P7','P10','P11');
END;

----------------------------------------------------------------------------
-- E3: ANÓNIMO en T1/KINE-401, acierto mixto (3 int1, 2 int2, 1 incorrecta)
----------------------------------------------------------------------------
IF (SELECT COUNT(*) FROM auris.evaluacion WHERE aplicacion_id=@apl_t1_c401 AND modalidad='ANONIMA') < 2
BEGIN
    INSERT INTO auris.evaluacion (aplicacion_id, modalidad, correo_estudiante, estado,
                                  iniciada_en, finalizada_en,
                                  total_preguntas, aciertos_primer, aciertos_segundo, incorrectas,
                                  porcentaje_global)
    VALUES (@apl_t1_c401, 'ANONIMA', NULL, 'FINALIZADA',
            DATEADD(HOUR, -25, SYSUTCDATETIME()), DATEADD(HOUR, -24, SYSUTCDATETIME()),
            6, 3, 2, 1, 83.33);
    SET @evalId = SCOPE_IDENTITY();
    -- P1, P3, P7 correctas al intento 1
    INSERT INTO auris.respuesta_pregunta
        (evaluacion_id, pregunta_id, orden_presentacion,
         alternativa_intento1_id, correcta_intento1, intentos_usados, resultado)
    SELECT @evalId, p.pregunta_id, ROW_NUMBER() OVER(ORDER BY p.clave),
           (SELECT TOP 1 alternativa_id FROM auris.alternativa
            WHERE pregunta_id=p.pregunta_id AND es_correcta=1),
           1, 1, 'CORRECTA_INT1'
    FROM #pregs p WHERE p.clave IN ('P1','P3','P7');
    -- P6, P10 correctas al intento 2
    INSERT INTO auris.respuesta_pregunta
        (evaluacion_id, pregunta_id, orden_presentacion,
         alternativa_intento1_id, correcta_intento1,
         alternativa_intento2_id, correcta_intento2,
         intentos_usados, resultado)
    SELECT @evalId, p.pregunta_id, 4 + ROW_NUMBER() OVER(ORDER BY p.clave),
           (SELECT TOP 1 alternativa_id FROM auris.alternativa
            WHERE pregunta_id=p.pregunta_id AND es_correcta=0 ORDER BY orden), 0,
           (SELECT TOP 1 alternativa_id FROM auris.alternativa
            WHERE pregunta_id=p.pregunta_id AND es_correcta=1), 1,
           2, 'CORRECTA_INT2'
    FROM #pregs p WHERE p.clave IN ('P6','P10');
    -- P11 incorrecta tras 2 intentos
    INSERT INTO auris.respuesta_pregunta
        (evaluacion_id, pregunta_id, orden_presentacion,
         alternativa_intento1_id, correcta_intento1,
         alternativa_intento2_id, correcta_intento2,
         intentos_usados, resultado)
    SELECT @evalId, p.pregunta_id, 6,
           (SELECT TOP 1 alternativa_id FROM auris.alternativa
            WHERE pregunta_id=p.pregunta_id AND es_correcta=0 ORDER BY orden), 0,
           (SELECT TOP 1 alternativa_id FROM auris.alternativa
            WHERE pregunta_id=p.pregunta_id AND es_correcta=0 ORDER BY orden DESC), 0,
           2, 'INCORRECTA'
    FROM #pregs p WHERE p.clave='P11';
END;

----------------------------------------------------------------------------
-- E4: IDENTIFICADO en T1/KINE-402 (mismo test, otro curso → RF-72)
----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM auris.evaluacion WHERE aplicacion_id=@apl_t1_c402 AND correo_estudiante='pedro.castro@uchile.cl')
BEGIN
    INSERT INTO auris.evaluacion (aplicacion_id, modalidad, correo_estudiante, estado,
                                  iniciada_en, finalizada_en,
                                  total_preguntas, aciertos_primer, aciertos_segundo, incorrectas,
                                  porcentaje_global, informe_enviado_en)
    VALUES (@apl_t1_c402, 'IDENTIFICADA', 'pedro.castro@uchile.cl', 'FINALIZADA',
            DATEADD(HOUR, -10, SYSUTCDATETIME()), DATEADD(HOUR, -9, SYSUTCDATETIME()),
            6, 4, 1, 1, 75.00, DATEADD(HOUR, -9, SYSUTCDATETIME()));
    SET @evalId = SCOPE_IDENTITY();
    INSERT INTO auris.respuesta_pregunta
        (evaluacion_id, pregunta_id, orden_presentacion,
         alternativa_intento1_id, correcta_intento1, intentos_usados, resultado)
    SELECT @evalId, p.pregunta_id, ROW_NUMBER() OVER(ORDER BY p.clave),
           (SELECT TOP 1 alternativa_id FROM auris.alternativa
            WHERE pregunta_id=p.pregunta_id AND es_correcta=1),
           1, 1, 'CORRECTA_INT1'
    FROM #pregs p WHERE p.clave IN ('P1','P3','P7','P10');
    -- P6 segundo intento
    INSERT INTO auris.respuesta_pregunta
        (evaluacion_id, pregunta_id, orden_presentacion,
         alternativa_intento1_id, correcta_intento1,
         alternativa_intento2_id, correcta_intento2,
         intentos_usados, resultado)
    SELECT @evalId, p.pregunta_id, 5,
           (SELECT TOP 1 alternativa_id FROM auris.alternativa WHERE pregunta_id=p.pregunta_id AND es_correcta=0 ORDER BY orden), 0,
           (SELECT TOP 1 alternativa_id FROM auris.alternativa WHERE pregunta_id=p.pregunta_id AND es_correcta=1), 1,
           2, 'CORRECTA_INT2'
    FROM #pregs p WHERE p.clave='P6';
    -- P11 incorrecta
    INSERT INTO auris.respuesta_pregunta
        (evaluacion_id, pregunta_id, orden_presentacion,
         alternativa_intento1_id, correcta_intento1,
         alternativa_intento2_id, correcta_intento2,
         intentos_usados, resultado)
    SELECT @evalId, p.pregunta_id, 6,
           (SELECT TOP 1 alternativa_id FROM auris.alternativa WHERE pregunta_id=p.pregunta_id AND es_correcta=0 ORDER BY orden), 0,
           (SELECT TOP 1 alternativa_id FROM auris.alternativa WHERE pregunta_id=p.pregunta_id AND es_correcta=0 ORDER BY orden DESC), 0,
           2, 'INCORRECTA'
    FROM #pregs p WHERE p.clave='P11';
END;

----------------------------------------------------------------------------
-- E5: ANÓNIMO en T2/KINE-501
----------------------------------------------------------------------------
IF (SELECT COUNT(*) FROM auris.evaluacion WHERE aplicacion_id=@apl_t2_c501) < 1
BEGIN
    INSERT INTO auris.evaluacion (aplicacion_id, modalidad, correo_estudiante, estado,
                                  iniciada_en, finalizada_en,
                                  total_preguntas, aciertos_primer, aciertos_segundo, incorrectas,
                                  porcentaje_global)
    VALUES (@apl_t2_c501, 'ANONIMA', NULL, 'FINALIZADA',
            DATEADD(HOUR, -8, SYSUTCDATETIME()), DATEADD(HOUR, -7, SYSUTCDATETIME()),
            5, 4, 0, 1, 80.00);
    SET @evalId = SCOPE_IDENTITY();
    INSERT INTO auris.respuesta_pregunta
        (evaluacion_id, pregunta_id, orden_presentacion,
         alternativa_intento1_id, correcta_intento1, intentos_usados, resultado)
    SELECT @evalId, p.pregunta_id, ROW_NUMBER() OVER(ORDER BY p.clave),
           (SELECT TOP 1 alternativa_id FROM auris.alternativa WHERE pregunta_id=p.pregunta_id AND es_correcta=1),
           1, 1, 'CORRECTA_INT1'
    FROM #pregs p WHERE p.clave IN ('P2','P3','P7','P10');
    -- P6 incorrecta tras 2 intentos
    INSERT INTO auris.respuesta_pregunta
        (evaluacion_id, pregunta_id, orden_presentacion,
         alternativa_intento1_id, correcta_intento1,
         alternativa_intento2_id, correcta_intento2,
         intentos_usados, resultado)
    SELECT @evalId, p.pregunta_id, 5,
           (SELECT TOP 1 alternativa_id FROM auris.alternativa WHERE pregunta_id=p.pregunta_id AND es_correcta=0 ORDER BY orden), 0,
           (SELECT TOP 1 alternativa_id FROM auris.alternativa WHERE pregunta_id=p.pregunta_id AND es_correcta=0 ORDER BY orden DESC), 0,
           2, 'INCORRECTA'
    FROM #pregs p WHERE p.clave='P6';
END;

----------------------------------------------------------------------------
-- E6: IDENTIFICADO en T3/KINE-403 – 10 preguntas, 8 correctas int1, 2 int2
----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM auris.evaluacion WHERE aplicacion_id=@apl_t3_c403 AND correo_estudiante='sofia.morales@uchile.cl')
BEGIN
    INSERT INTO auris.evaluacion (aplicacion_id, modalidad, correo_estudiante, estado,
                                  iniciada_en, finalizada_en,
                                  total_preguntas, aciertos_primer, aciertos_segundo, incorrectas,
                                  porcentaje_global, informe_enviado_en)
    VALUES (@apl_t3_c403, 'IDENTIFICADA', 'sofia.morales@uchile.cl', 'FINALIZADA',
            DATEADD(HOUR, -5, SYSUTCDATETIME()), DATEADD(HOUR, -4, SYSUTCDATETIME()),
            10, 8, 2, 0, 100.00, DATEADD(HOUR, -4, SYSUTCDATETIME()));
    SET @evalId = SCOPE_IDENTITY();
    -- 8 al primer intento
    INSERT INTO auris.respuesta_pregunta
        (evaluacion_id, pregunta_id, orden_presentacion,
         alternativa_intento1_id, correcta_intento1, intentos_usados, resultado)
    SELECT @evalId, p.pregunta_id, ROW_NUMBER() OVER(ORDER BY p.clave),
           (SELECT TOP 1 alternativa_id FROM auris.alternativa WHERE pregunta_id=p.pregunta_id AND es_correcta=1),
           1, 1, 'CORRECTA_INT1'
    FROM #pregs p WHERE p.clave IN ('P1','P2','P4','P5','P6','P8','P11','P12');
    -- 2 al segundo intento
    INSERT INTO auris.respuesta_pregunta
        (evaluacion_id, pregunta_id, orden_presentacion,
         alternativa_intento1_id, correcta_intento1,
         alternativa_intento2_id, correcta_intento2,
         intentos_usados, resultado)
    SELECT @evalId, p.pregunta_id, 8 + ROW_NUMBER() OVER(ORDER BY p.clave),
           (SELECT TOP 1 alternativa_id FROM auris.alternativa WHERE pregunta_id=p.pregunta_id AND es_correcta=0 ORDER BY orden), 0,
           (SELECT TOP 1 alternativa_id FROM auris.alternativa WHERE pregunta_id=p.pregunta_id AND es_correcta=1), 1,
           2, 'CORRECTA_INT2'
    FROM #pregs p WHERE p.clave IN ('P9','P10');
END;

----------------------------------------------------------------------------
-- E7: Evaluación EN_CURSO (no finalizada)
----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM auris.evaluacion WHERE aplicacion_id=@apl_t1_c401 AND estado='EN_CURSO')
BEGIN
    INSERT INTO auris.evaluacion (aplicacion_id, modalidad, correo_estudiante, estado, iniciada_en)
    VALUES (@apl_t1_c401, 'IDENTIFICADA', 'estudiante.activo@uchile.cl', 'EN_CURSO',
            DATEADD(MINUTE, -10, SYSUTCDATETIME()));
    SET @evalId = SCOPE_IDENTITY();
    -- 2 respuestas registradas hasta ahora
    INSERT INTO auris.respuesta_pregunta
        (evaluacion_id, pregunta_id, orden_presentacion,
         alternativa_intento1_id, correcta_intento1, intentos_usados, resultado)
    SELECT @evalId, p.pregunta_id, ROW_NUMBER() OVER(ORDER BY p.clave),
           (SELECT TOP 1 alternativa_id FROM auris.alternativa WHERE pregunta_id=p.pregunta_id AND es_correcta=1),
           1, 1, 'CORRECTA_INT1'
    FROM #pregs p WHERE p.clave IN ('P1','P3');
END;

/* =============================================================================
   9) LOG DE AUDITORÍA – ejemplos (RNF-25)
   ============================================================================= */

INSERT INTO auris.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle_json, ip_origen)
SELECT @adminId, 'CURSO_CREADO', 'curso', CAST(curso_id AS VARCHAR(60)),
       N'{"codigo":"' + codigo + N'","nombre":"' + nombre + N'"}', '127.0.0.1'
FROM auris.curso
WHERE NOT EXISTS (
    SELECT 1 FROM auris.log_auditoria la
    WHERE la.accion='CURSO_CREADO' AND la.entidad='curso' AND la.entidad_id=CAST(curso_id AS VARCHAR(60))
);

INSERT INTO auris.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle_json, ip_origen)
SELECT @adminId, 'INVITACION_ENVIADA', 'invitacion_profesor', CAST(invitacion_id AS VARCHAR(60)),
       N'{"correo_destino":"' + correo_destino + N'"}', '127.0.0.1'
FROM auris.invitacion_profesor
WHERE NOT EXISTS (
    SELECT 1 FROM auris.log_auditoria la
    WHERE la.accion='INVITACION_ENVIADA' AND la.entidad='invitacion_profesor'
      AND la.entidad_id=CAST(invitacion_id AS VARCHAR(60))
);

COMMIT TRAN;
GO

/* =============================================================================
   10) RESUMEN FINAL – conteo por tabla
   ============================================================================= */

PRINT '====================================================================';
PRINT 'Datos de prueba cargados. Conteos por tabla:';

SELECT 'usuario'             AS tabla, COUNT(*) AS filas FROM auris.usuario
UNION ALL SELECT 'usuario_rol',          COUNT(*) FROM auris.usuario_rol
UNION ALL SELECT 'curso',                COUNT(*) FROM auris.curso
UNION ALL SELECT 'profesor_curso',       COUNT(*) FROM auris.profesor_curso
UNION ALL SELECT 'pregunta',             COUNT(*) FROM auris.pregunta
UNION ALL SELECT 'alternativa',          COUNT(*) FROM auris.alternativa
UNION ALL SELECT 'test',                 COUNT(*) FROM auris.test
UNION ALL SELECT 'test_pregunta',        COUNT(*) FROM auris.test_pregunta
UNION ALL SELECT 'aplicacion_test',      COUNT(*) FROM auris.aplicacion_test
UNION ALL SELECT 'invitacion_profesor',  COUNT(*) FROM auris.invitacion_profesor
UNION ALL SELECT 'evaluacion',           COUNT(*) FROM auris.evaluacion
UNION ALL SELECT 'respuesta_pregunta',   COUNT(*) FROM auris.respuesta_pregunta
UNION ALL SELECT 'log_auditoria',        COUNT(*) FROM auris.log_auditoria
ORDER BY tabla;
GO

PRINT 'Resumen de analítica por aplicación:';
SELECT * FROM auris.vw_porcentaje_aplicacion ORDER BY aplicacion_id;
GO

PRINT '====================================================================';
PRINT 'Población completa.';
GO
