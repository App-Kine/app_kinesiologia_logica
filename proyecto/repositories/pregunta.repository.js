"use strict";

/**
 * Repositorio de preguntas + alternativas.
 * Cubre RF-62 a RF-66 (creación con validaciones de cardinalidad y única correcta).
 *
 * La invariante "exactamente 1 alternativa correcta" la garantiza el índice
 * único filtrado UX_alt_unica_correcta en SQL Server; aquí solo validamos
 * antes para devolver un error legible.
 */

var db = require("../../base/utils/db");

const TAG_ERR = "\x1b[31m[pregunta.repo]\x1b[0m";

/**
 * Inserta una pregunta junto a sus alternativas en una sola transacción.
 *
 * @param {object} p
 * @param {string} p.enunciado
 * @param {string} p.explicacionClinica
 * @param {string|null} p.audioGridId       ObjectId hex (24) o null
 * @param {string|null} p.imagenGridId      ObjectId hex (24) o null
 * @param {number} p.creadoPor              usuario_id del profesor
 * @param {number|null} p.cursoOrigenId
 * @param {Array<{texto:string, esCorrecta:boolean, orden:number}>} p.alternativas
 * @returns {Promise<number>} pregunta_id
 */
async function crearPreguntaConAlternativas(p) {
    const pool = db.getPool("auris");
    const tx = new db.sql.Transaction(pool);
    await tx.begin();
    try {
        const reqP = new db.sql.Request(tx);
        const r = await reqP
            .input("enunciado", db.sql.NVarChar(2000), p.enunciado)
            .input("explicacion_clinica", db.sql.NVarChar(4000), p.explicacionClinica)
            .input("audio_grid_id", db.sql.VarChar(24), p.audioGridId || null)
            .input("imagen_grid_id", db.sql.VarChar(24), p.imagenGridId || null)
            .input("creado_por", db.sql.BigInt, p.creadoPor)
            .input("curso_origen_id", db.sql.BigInt, p.cursoOrigenId || null)
            .query(`
                INSERT INTO auris.pregunta
                    (enunciado, explicacion_clinica, audio_grid_id,
                     imagen_grid_id, creado_por, curso_origen_id)
                OUTPUT INSERTED.pregunta_id
                VALUES (@enunciado, @explicacion_clinica, @audio_grid_id,
                        @imagen_grid_id, @creado_por, @curso_origen_id);
            `);
        const preguntaId = r.recordset[0].pregunta_id;

        for (const alt of p.alternativas) {
            const reqA = new db.sql.Request(tx);
            await reqA
                .input("pregunta_id", db.sql.BigInt, preguntaId)
                .input("texto", db.sql.NVarChar(1000), alt.texto)
                .input("es_correcta", db.sql.Bit, alt.esCorrecta ? 1 : 0)
                .input("orden", db.sql.TinyInt, alt.orden)
                .query(`
                    INSERT INTO auris.alternativa
                        (pregunta_id, texto, es_correcta, orden)
                    VALUES (@pregunta_id, @texto, @es_correcta, @orden);
                `);
        }

        await tx.commit();
        return preguntaId;
    } catch (e) {
        logger.log(`${TAG_ERR} crearPreguntaConAlternativas rollback: ${e.message}`, e);
        try { await tx.rollback(); } catch (_) {}
        throw e;
    }
}

/**
 * Lista preguntas creadas por un profesor (o todas si es null).
 * No retorna alternativas para mantener el payload liviano.
 */
async function listarPorProfesor(profesorId) {
    const r = await db
        .request("auris")
        .input("profesor_id", db.sql.BigInt, profesorId || null)
        .query(`
            SELECT  p.pregunta_id,
                    p.enunciado,
                    p.curso_origen_id,
                    c.nombre        AS curso_nombre,
                    p.audio_grid_id,
                    p.imagen_grid_id,
                    p.activo,
                    p.created_at,
                    p.updated_at
            FROM    auris.pregunta p
            LEFT JOIN auris.curso c ON c.curso_id = p.curso_origen_id
            WHERE   p.activo = 1
              AND  (@profesor_id IS NULL OR p.creado_por = @profesor_id)
            ORDER BY p.created_at DESC;
        `);
    return r.recordset;
}

/**
 * Devuelve una pregunta con sus alternativas. Null si no existe.
 */
async function obtenerConAlternativas(preguntaId) {
    const pool = db.getPool("auris");

    const rPreg = await pool
        .request()
        .input("pregunta_id", db.sql.BigInt, preguntaId)
        .query(`
            SELECT  pregunta_id, enunciado, explicacion_clinica,
                    audio_grid_id, imagen_grid_id,
                    creado_por, curso_origen_id, clonada_de_id,
                    activo, created_at, updated_at
            FROM    auris.pregunta
            WHERE   pregunta_id = @pregunta_id;
        `);
    if (rPreg.recordset.length === 0) return null;

    const rAlt = await pool
        .request()
        .input("pregunta_id", db.sql.BigInt, preguntaId)
        .query(`
            SELECT  alternativa_id, texto, es_correcta, orden
            FROM    auris.alternativa
            WHERE   pregunta_id = @pregunta_id
            ORDER BY orden;
        `);

    const pregunta = rPreg.recordset[0];
    pregunta.alternativas = rAlt.recordset;
    return pregunta;
}

module.exports = {
    crearPreguntaConAlternativas,
    listarPorProfesor,
    obtenerConAlternativas,
};
