"use strict";

/**
 * Repositorio de invitaciones de profesor.
 * Cubre las queries asociadas a RF-76 a RF-87 y RNF-12.
 */

var db = require("../../base/utils/db");

const ESTADOS = {
    PENDIENTE: "PENDIENTE",
    COMPLETADA: "COMPLETADA",
    EXPIRADA: "EXPIRADA",
    REENVIADA: "REENVIADA",
};

/**
 * Inserta una invitación.
 * @returns {Promise<string>} invitacion_id (UUID)
 */
async function crearInvitacion(
    correoDestino,
    tokenHash,
    expiraEn,
    creadaPor,
    invitacionPreviaId
) {
    const r = await db
        .request("auris")
        .input("correo_destino", db.sql.NVarChar(254), correoDestino)
        .input("token_hash", db.sql.Char(64), tokenHash)
        .input("expira_en", db.sql.DateTime2, expiraEn)
        .input("creada_por", db.sql.BigInt, creadaPor)
        .input(
            "invitacion_previa_id",
            db.sql.UniqueIdentifier,
            invitacionPreviaId || null
        )
        .query(`
            DECLARE @id UNIQUEIDENTIFIER = NEWID();
            INSERT INTO auris.invitacion_profesor
                (invitacion_id, correo_destino, token_hash, estado,
                 expira_en, creada_por, invitacion_previa_id)
            VALUES (@id, @correo_destino, @token_hash, 'PENDIENTE',
                    @expira_en, @creada_por, @invitacion_previa_id);
            SELECT @id AS invitacion_id;
        `);
    return r.recordset[0].invitacion_id;
}

/**
 * Busca una invitación por su hash de token. Devuelve null si no existe.
 * NO marca como expirada — eso lo hace el caller si quiere (lazy expiration).
 */
async function buscarPorTokenHash(tokenHash) {
    const r = await db
        .request("auris")
        .input("token_hash", db.sql.Char(64), tokenHash)
        .query(`
            SELECT invitacion_id, correo_destino, token_hash, estado,
                   expira_en, creada_por, creada_en, completada_en
            FROM   auris.invitacion_profesor
            WHERE  token_hash = @token_hash
        `);
    return r.recordset[0] || null;
}

/**
 * Devuelve la invitación PENDIENTE más reciente para un correo, o null.
 */
async function buscarPendientePorCorreo(correo) {
    const r = await db
        .request("auris")
        .input("correo", db.sql.NVarChar(254), correo)
        .query(`
            SELECT TOP 1 invitacion_id, correo_destino, estado, expira_en, creada_en
            FROM   auris.invitacion_profesor
            WHERE  correo_destino = @correo
              AND  estado = 'PENDIENTE'
            ORDER BY creada_en DESC
        `);
    return r.recordset[0] || null;
}

/**
 * Marca una invitación como REENVIADA (cuando se crea otra nueva para el mismo correo).
 */
async function marcarReenviada(invitacionId) {
    await db
        .request("auris")
        .input("invitacion_id", db.sql.UniqueIdentifier, invitacionId)
        .query(`
            UPDATE auris.invitacion_profesor
            SET    estado = 'REENVIADA'
            WHERE  invitacion_id = @invitacion_id
              AND  estado = 'PENDIENTE'
        `);
}

/**
 * Marca una invitación como COMPLETADA cuando el profesor termina su registro.
 */
async function marcarCompletada(invitacionId, usuarioIdCreado) {
    await db
        .request("auris")
        .input("invitacion_id", db.sql.UniqueIdentifier, invitacionId)
        .input("usuario_id_creado", db.sql.BigInt, usuarioIdCreado)
        .query(`
            UPDATE auris.invitacion_profesor
            SET    estado = 'COMPLETADA',
                   completada_en = SYSUTCDATETIME(),
                   usuario_id_creado = @usuario_id_creado
            WHERE  invitacion_id = @invitacion_id
        `);
}

/**
 * Actualiza al estado EXPIRADA las pendientes cuyo expira_en ya pasó.
 * Útil llamarlo antes de listar (lazy expiration).
 */
async function marcarPendientesVencidasComoExpiradas() {
    await db.request("auris").query(`
        UPDATE auris.invitacion_profesor
        SET    estado = 'EXPIRADA'
        WHERE  estado = 'PENDIENTE'
          AND  expira_en < SYSUTCDATETIME();
    `);
}

/**
 * Lista todas las invitaciones para el panel admin (RF-83).
 */
async function listarTodas() {
    const r = await db
        .request("auris")
        .query(`
            SELECT inv.invitacion_id,
                   inv.correo_destino,
                   inv.estado,
                   inv.creada_en,
                   inv.expira_en,
                   inv.completada_en,
                   creador.correo  AS creada_por_correo,
                   creador.nombre  AS creada_por_nombre
            FROM   auris.invitacion_profesor inv
            LEFT JOIN auris.usuario creador ON creador.usuario_id = inv.creada_por
            ORDER BY inv.creada_en DESC
        `);
    return r.recordset;
}

module.exports = {
    ESTADOS,
    crearInvitacion,
    buscarPorTokenHash,
    buscarPendientePorCorreo,
    marcarReenviada,
    marcarCompletada,
    marcarPendientesVencidasComoExpiradas,
    listarTodas,
};
