"use strict";

/**
 * Repositorio de usuario interno (profesor / superadmin).
 * Aísla SQL del resto del backend (RNF-04, RNF-14).
 */

var db = require("../../base/utils/db");

/**
 * Busca un usuario por correo. Devuelve null si no existe.
 * @param {string} correo
 */
async function findByCorreo(correo) {
    const r = await db
        .request("auris")
        .input("correo", db.sql.NVarChar(254), correo)
        .query(`
            SELECT  usuario_id,
                    nombre,
                    correo,
                    password_hash,
                    activo
            FROM    auris.usuario
            WHERE   correo = @correo
        `);
    return r.recordset[0] || null;
}

/**
 * Devuelve los roles (códigos) del usuario.
 * @param {number} usuarioId
 * @returns {Promise<string[]>}
 */
async function findRoles(usuarioId) {
    const r = await db
        .request("auris")
        .input("usuario_id", db.sql.BigInt, usuarioId)
        .query(`
            SELECT  r.codigo
            FROM    auris.usuario_rol ur
            JOIN    auris.rol r ON r.rol_id = ur.rol_id
            WHERE   ur.usuario_id = @usuario_id
            ORDER BY r.codigo
        `);
    return r.recordset.map((x) => x.codigo);
}

/**
 * Cuenta intentos fallidos consecutivos sobre un correo dentro de la
 * ventana de los últimos `minutos`. Usado para bloqueo RF-60.
 *
 * Si hay un intento exitoso reciente, el conteo se "resetea" en el sentido
 * de que el bloqueo solo aplica si los últimos N fueron todos fallidos.
 *
 * @param {string} correo
 * @param {number} minutos
 * @returns {Promise<number>}
 */
async function contarIntentosFallidosRecientes(correo, minutos) {
    const r = await db
        .request("auris")
        .input("correo", db.sql.NVarChar(254), correo)
        .input("minutos", db.sql.Int, minutos)
        .query(`
            SELECT COUNT(*) AS fallidos
            FROM   auris.login_intento li
            WHERE  li.correo = @correo
              AND  li.exitoso = 0
              AND  li.ocurrido_en >= DATEADD(MINUTE, -@minutos, SYSUTCDATETIME())
              AND  li.ocurrido_en > ISNULL(
                    (SELECT MAX(ocurrido_en)
                     FROM auris.login_intento
                     WHERE correo = @correo AND exitoso = 1),
                    '1900-01-01');
        `);
    return r.recordset[0].fallidos;
}

/**
 * Registra un intento de login (exitoso o fallido).
 * @param {string} correo
 * @param {boolean} exitoso
 * @param {string|null} ipOrigen
 */
async function registrarIntentoLogin(correo, exitoso, ipOrigen) {
    await db
        .request("auris")
        .input("correo", db.sql.NVarChar(254), correo)
        .input("exitoso", db.sql.Bit, exitoso ? 1 : 0)
        .input("ip_origen", db.sql.VarChar(45), ipOrigen || null)
        .query(`
            INSERT INTO auris.login_intento (correo, exitoso, ip_origen)
            VALUES (@correo, @exitoso, @ip_origen);
        `);
}

/**
 * Guarda el hash SHA-256 del refresh token (RNF-18).
 * @param {number} usuarioId
 * @param {string} tokenHash    SHA-256 hex, 64 chars
 * @param {Date} expiraEn
 * @param {string|null} ipOrigen
 * @param {string|null} userAgent
 */
async function guardarRefreshToken(usuarioId, tokenHash, expiraEn, ipOrigen, userAgent) {
    await db
        .request("auris")
        .input("usuario_id", db.sql.BigInt, usuarioId)
        .input("token_hash", db.sql.Char(64), tokenHash)
        .input("expira_en", db.sql.DateTime2, expiraEn)
        .input("ip_origen", db.sql.VarChar(45), ipOrigen || null)
        .input("user_agent", db.sql.NVarChar(400), userAgent || null)
        .query(`
            INSERT INTO auris.refresh_token
                (usuario_id, token_hash, expira_en, ip_origen, user_agent)
            VALUES (@usuario_id, @token_hash, @expira_en, @ip_origen, @user_agent);
        `);
}

/**
 * Comprueba si un correo ya está registrado como usuario (RF-86).
 * Usa case-insensitive porque el colation por defecto en SQL Server lo es.
 * @param {string} correo
 */
async function correoYaRegistrado(correo) {
    const r = await db
        .request("auris")
        .input("correo", db.sql.NVarChar(254), correo)
        .query(`
            SELECT COUNT(*) AS total
            FROM   auris.usuario
            WHERE  correo = @correo
        `);
    return r.recordset[0].total > 0;
}

/**
 * Crea un usuario profesor (RF-81) y le asigna el rol PROFESOR.
 * Devuelve el usuario_id creado.
 *
 * @param {string} nombre
 * @param {string} correo
 * @param {string} passwordHash    ya hasheado con bcrypt
 * @returns {Promise<number>}
 */
async function crearUsuarioProfesor(nombre, correo, passwordHash) {
    const ROL_PROFESOR_ID = 2;

    const pool = db.getPool("auris");
    const tx = new db.sql.Transaction(pool);
    await tx.begin();
    try {
        const reqUser = new db.sql.Request(tx);
        const r = await reqUser
            .input("nombre", db.sql.NVarChar(120), nombre)
            .input("correo", db.sql.NVarChar(254), correo)
            .input("password_hash", db.sql.NVarChar(255), passwordHash)
            .query(`
                INSERT INTO auris.usuario (nombre, correo, password_hash, activo)
                OUTPUT INSERTED.usuario_id
                VALUES (@nombre, @correo, @password_hash, 1);
            `);
        const usuarioId = r.recordset[0].usuario_id;

        const reqRol = new db.sql.Request(tx);
        await reqRol
            .input("usuario_id", db.sql.BigInt, usuarioId)
            .input("rol_id", db.sql.TinyInt, ROL_PROFESOR_ID)
            .query(`
                INSERT INTO auris.usuario_rol (usuario_id, rol_id)
                VALUES (@usuario_id, @rol_id);
            `);

        await tx.commit();
        return usuarioId;
    } catch (e) {
        await tx.rollback();
        throw e;
    }
}

/**
 * Lista todos los usuarios internos con sus roles (para el panel admin).
 * Devuelve roles como arreglo de códigos.
 */
async function listarUsuarios() {
    const r = await db.request("auris").query(`
        SELECT  u.usuario_id,
                u.nombre,
                u.correo,
                u.activo,
                u.created_at,
                STRING_AGG(r.codigo, ',') AS roles
        FROM    auris.usuario u
        LEFT JOIN auris.usuario_rol ur ON ur.usuario_id = u.usuario_id
        LEFT JOIN auris.rol r          ON r.rol_id      = ur.rol_id
        GROUP BY u.usuario_id, u.nombre, u.correo, u.activo, u.created_at
        ORDER BY u.activo DESC, u.nombre;
    `);
    return r.recordset.map((u) => ({
        usuario_id: u.usuario_id,
        nombre: u.nombre,
        correo: u.correo,
        activo: !!u.activo,
        created_at: u.created_at,
        roles: u.roles ? String(u.roles).split(",") : [],
    }));
}

/**
 * Activa/desactiva un usuario (soft-delete). Devuelve filas afectadas.
 * @param {number} usuarioId
 * @param {boolean} activo
 */
async function setActivoUsuario(usuarioId, activo) {
    const r = await db
        .request("auris")
        .input("usuario_id", db.sql.BigInt, usuarioId)
        .input("activo", db.sql.Bit, activo ? 1 : 0)
        .query(`
            UPDATE auris.usuario
            SET    activo = @activo, updated_at = SYSUTCDATETIME()
            WHERE  usuario_id = @usuario_id;
        `);
    return r.rowsAffected[0];
}

/**
 * ¿El usuario es el ÚNICO superadmin activo? (para no quedarse sin admins).
 * @param {number} usuarioId
 * @returns {Promise<boolean>}
 */
async function esUltimoSuperadminActivo(usuarioId) {
    const r = await db
        .request("auris")
        .input("usuario_id", db.sql.BigInt, usuarioId)
        .query(`
            SELECT
              (SELECT COUNT(*)
                 FROM auris.usuario_rol ur
                 JOIN auris.rol r ON r.rol_id = ur.rol_id
                 WHERE r.codigo = 'SUPERADMIN' AND ur.usuario_id = @usuario_id) AS esSuper,
              (SELECT COUNT(*)
                 FROM auris.usuario_rol ur
                 JOIN auris.rol r      ON r.rol_id = ur.rol_id
                 JOIN auris.usuario u  ON u.usuario_id = ur.usuario_id
                 WHERE r.codigo = 'SUPERADMIN' AND u.activo = 1) AS totalSuperActivos;
        `);
    const row = r.recordset[0] || {};
    return row.esSuper > 0 && row.totalSuperActivos <= 1;
}

module.exports = {
    findByCorreo,
    findRoles,
    contarIntentosFallidosRecientes,
    registrarIntentoLogin,
    guardarRefreshToken,
    correoYaRegistrado,
    crearUsuarioProfesor,
    listarUsuarios,
    setActivoUsuario,
    esUltimoSuperadminActivo,
};
