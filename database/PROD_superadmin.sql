/* =============================================================================
   Auris · PRODUCCIÓN — Seed mínimo de seguridad (solo superadmin)
   -----------------------------------------------------------------------------
   En PRODUCCIÓN NO se cargan los usuarios de demo (admin@auris.local,
   profesores, etc. con la clave por defecto 'ChangeMe!2026'). Solo se crea
   UN superadmin con una contraseña FUERTE y única.

   PASOS:
     1) Generar el hash bcrypt de tu clave fuerte (valida la política RNF-13:
        min 10, mayúscula, minúscula, número y símbolo):

            cd app_kinesiologia_logica
            node scripts/generar_hash.js "TuClaveFuerte!2026"

     2) Copiar el "Hash bcrypt:" que imprime y pegarlo en @hash de abajo.
     3) Poner el correo institucional real del admin en @correo.
     4) Ejecutar este script contra la BD de PRODUCCIÓN.

   (El seed de demo sigue en AurisDB_INSTALL.sql, solo para desarrollo local.)
   ============================================================================= */

-- Roles base (idempotente)
IF NOT EXISTS (SELECT 1 FROM auris.rol WHERE rol_id = 1)
    INSERT INTO auris.rol (rol_id, codigo, descripcion) VALUES
        (1, 'SUPERADMIN', N'Administrador del sistema. Privilegios máximos.'),
        (2, 'PROFESOR',   N'Crea contenido, gestiona tests y consulta analítica.');
GO

DECLARE @correo NVARCHAR(254) = N'CAMBIAR@dominio-institucional';   -- correo real
DECLARE @hash   NVARCHAR(255) = N'PEGAR_HASH_BCRYPT_DE_generar_hash.js';
DECLARE @nombre NVARCHAR(120) = N'Administrador Auris';

IF (@hash = N'PEGAR_HASH_BCRYPT_DE_generar_hash.js' OR @correo LIKE N'CAMBIAR@%')
BEGIN
    RAISERROR('Debes definir @correo y @hash reales antes de ejecutar.', 16, 1);
    RETURN;
END

IF EXISTS (SELECT 1 FROM auris.usuario WHERE correo = @correo)
BEGIN
    RAISERROR('Ya existe un usuario con ese correo. Aborta para no duplicar.', 16, 1);
    RETURN;
END

DECLARE @id BIGINT;
INSERT INTO auris.usuario (nombre, correo, password_hash, activo)
VALUES (@nombre, @correo, @hash, 1);
SET @id = SCOPE_IDENTITY();

-- SUPERADMIN (1) + PROFESOR (2) para que también pueda crear contenido.
INSERT INTO auris.usuario_rol (usuario_id, rol_id) VALUES (@id, 1), (@id, 2);

PRINT 'Superadmin de producción creado correctamente.';
GO
