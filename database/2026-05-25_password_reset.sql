/* =============================================================================
   Migración: tabla de recuperación de contraseña (RF-59)
   Tokens de un solo uso, con hash (sha256) y expiración corta.
   Mismo patrón que auris.invitacion_profesor / auris.refresh_token.
   ============================================================================= */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID(N'auris.password_reset', N'U') IS NULL
CREATE TABLE auris.password_reset (
    reset_id    BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    usuario_id  BIGINT          NOT NULL,
    token_hash  CHAR(64)        NOT NULL,          -- sha256 hex del token plano
    expira_en   DATETIME2(3)    NOT NULL,
    usado_en    DATETIME2(3)    NULL,
    creada_en   DATETIME2(3)    NOT NULL CONSTRAINT DF_pwreset_creada DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_pwreset_usuario FOREIGN KEY (usuario_id) REFERENCES auris.usuario(usuario_id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pwreset_token' AND object_id = OBJECT_ID('auris.password_reset'))
    CREATE INDEX IX_pwreset_token ON auris.password_reset(token_hash);
GO
