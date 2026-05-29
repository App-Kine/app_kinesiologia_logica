"use strict";

/**
 * Repositorio de auditoría (Bloque P2.R8 — auditoría ISO 25010).
 *
 * Inserta filas en auris.log_auditoria capturando:
 *   - quién hizo la acción (usuario_id)
 *   - qué acción (PREGUNTA_EDITADA, TEST_EDITADO, etc.)
 *   - sobre qué entidad (entidad + entidad_id)
 *   - JSON de detalle con before/after cuando aplica
 *
 * El log soporta NO REPUDIO (5.6.3 ISO 25010) y FORENSICS post-incidente.
 */

var db = require("../../base/utils/db");

const TAG_ERR = "\x1b[31m[audit]\x1b[0m";

/**
 * Inserta un registro de auditoría.
 * No tira si falla (no debe bloquear la operación principal); solo loggea.
 *
 * @param {object} params
 * @param {number|null} params.usuarioId    quien hizo la acción
 * @param {string} params.accion            ej. "PREGUNTA_EDITADA"
 * @param {string} params.entidad           ej. "pregunta"
 * @param {string|number|null} params.entidadId
 * @param {object|null} params.detalle      objeto serializable (before/after)
 * @param {string|null} params.ipOrigen
 */
async function registrar({ usuarioId, accion, entidad, entidadId, detalle, ipOrigen }) {
    try {
        await db.request("auris")
            .input("usuario_id", db.sql.BigInt, usuarioId || null)
            .input("accion", db.sql.VarChar(60), accion)
            .input("entidad", db.sql.VarChar(60), entidad)
            .input("entidad_id", db.sql.VarChar(60),
                entidadId != null ? String(entidadId) : null)
            .input("detalle", db.sql.NVarChar(db.sql.MAX),
                detalle != null ? JSON.stringify(detalle) : null)
            .input("ip_origen", db.sql.VarChar(45), ipOrigen || null)
            .query(`
                INSERT INTO auris.log_auditoria
                    (usuario_id, accion, entidad, entidad_id, detalle_json, ip_origen)
                VALUES (@usuario_id, @accion, @entidad, @entidad_id, @detalle, @ip_origen);
            `);
    } catch (e) {
        // Nunca bloqueamos la operación principal por un fallo en auditoría.
        logger.log(`${TAG_ERR} registrar (${accion}): ${e.message}`);
    }
}

/**
 * Diff "minimal" entre dos objetos: devuelve solo los campos cambiados,
 * en formato { campo: { antes, despues } }. Útil para detalle_json.
 */
function diff(antes, despues, campos) {
    const out = {};
    for (const k of campos) {
        const a = antes ? antes[k] : undefined;
        const d = despues ? despues[k] : undefined;
        if (JSON.stringify(a) !== JSON.stringify(d)) {
            out[k] = { antes: a, despues: d };
        }
    }
    return out;
}

module.exports = { registrar, diff };
