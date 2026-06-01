/* =============================================================================
   Auris · PRODUCCIÓN — Usuario de base de datos con privilegios mínimos
   -----------------------------------------------------------------------------
   La app NO debe conectarse como 'sa'. Este script crea un login/usuario
   dedicado ('auris_app') que solo puede leer/escribir las tablas del esquema
   'auris' — sin permisos de administración, sin DDL, sin acceso a otras BD.

   Lo ejecuta DTIC/infra UNA vez contra la BD de producción.
   Después: configurar las env vars de la lógica con este usuario:
       DB_USER=auris_app
       DB_PASS=<la clave fuerte que pongas abajo>

   (En desarrollo local pueden seguir usando 'sa'; esto es solo para prod.)
   ============================================================================= */

USE master;
GO

-- 1) Login a nivel de servidor. CHECK_POLICY = ON exige clave fuerte (Windows/AD).
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'auris_app')
    CREATE LOGIN auris_app
        WITH PASSWORD = 'CAMBIAR_POR_CLAVE_FUERTE_UNICA', CHECK_POLICY = ON;
GO

USE AurisDB;
GO

-- 2) Usuario de la BD mapeado al login.
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'auris_app')
    CREATE USER auris_app FOR LOGIN auris_app;
GO

-- 3) Privilegios MÍNIMOS: solo CRUD (+ EXECUTE de procedimientos) sobre el
--    esquema 'auris'. Nada de ALTER/DROP/CREATE ni db_owner.
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::auris TO auris_app;
GRANT EXECUTE ON SCHEMA::auris TO auris_app;
GO

-- 4) (Opcional) Verificar permisos otorgados:
-- SELECT * FROM fn_my_permissions('auris', 'SCHEMA');
