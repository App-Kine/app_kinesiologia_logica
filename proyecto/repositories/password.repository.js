"use strict";

/**
 * Repositorio de recuperación de contraseña (RF-59).
 * Tokens de un solo uso (hash sha256) con expiración corta.
 */

var db = require("../../base/utils/db");

/** Usuario interno activo por correo. Null si no existe o está inactivo. */
async function buscarUsuarioActivoPorCorreo(correo) {
    const r = await db
        .request("auris")
        .input("correo", db.sql.NVarChar(254), correo)
        .query(`
            SELECT usuario_id, nombre, correo, activo
            FROM   auris.usuario
            WHERE  correo = @correo AND activo = 1;
        `);
    return r.recordset[0] || null;
}

/** Invalida (marca usados) los resets pendientes previos de un usuario. */
async function invalidarResetsPrevios(usuarioId) {
    await db
        .request("auris")
        .input("usuario_id", db.sql.BigInt, usuarioId)
        .query(`
            UPDATE auris.password_reset
            SET    usado_en = SYSUTCDATETIME()
            WHERE  usuario_id = @usuario_id AND usado_en IS NULL;
        `);
}

/** Crea un token de reseteo. @returns reset_id */
async function crearReset(usuarioId, tokenHash, expiraEn) {
    const r = await db
        .request("auris")
        .input("usuario_id", db.sql.BigInt, usuarioId)
        .input("token_hash", db.sql.Char(64), tokenHash)
        .input("expira_en", db.sql.DateTime2, expiraEn)
        .query(`
            INSERT INTO auris.password_reset (usuario_id, token_hash, expira_en)
            OUTPUT INSERTED.reset_id
            VALUES (@usuario_id, @token_hash, @expira_en);
        `);
    return r.recordset[0].reset_id;
}

/** Busca un reset por hash de token. Null si no existe. */
async function buscarPorTokenHash(tokenHash) {
    const r = await db
        .request("auris")
        .input("token_hash", db.sql.Char(64), tokenHash)
        .query(`
            SELECT reset_id, usuario_id, expira_en, usado_en
            FROM   auris.password_reset
            WHERE  token_hash = @token_hash;
        `);
    return r.recordset[0] || null;
}

/** Cambia la contraseña del usuario y marca el reset como usado, en una transacción. */
async function aplicarNuevaPassword(resetId, usuarioId, passwordHash) {
    const pool = db.getPool("auris");
    const tx = new db.sql.Transaction(pool);
    await tx.begin();
    try {
        await new db.sql.Request(tx)
            .input("usuario_id", db.sql.BigInt, usuarioId)
            .input("password_hash", db.sql.NVarChar(255), passwordHash)
            .query(`
                UPDATE auris.usuario
                SET    password_hash = @password_hash
                WHERE  usuario_id = @usuario_id;
            `);
        await new db.sql.Request(tx)
            .input("reset_id", db.sql.BigInt, resetId)
            .query(`
                UPDATE auris.password_reset
                SET    usado_en = SYSUTCDATETIME()
                WHERE  reset_id = @reset_id;
            `);
        await tx.commit();
    } catch (e) {
        try { await tx.rollback(); } catch (_) {}
        throw e;
    }
}

module.exports = {
    buscarUsuarioActivoPorCorreo,
    invalidarResetsPrevios,
    crearReset,
    buscarPorTokenHash,
    aplicarNuevaPassword,
};
