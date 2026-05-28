"use strict";

/**
 * Repositorio de tests (auris.test) + composición auris.test_pregunta.
 * Cubre RF-69 (crear test asociando preguntas con orden) y RF-15
 * (orden secuencial o aleatorio configurable).
 */

var db = require("../../base/utils/db");

const TAG_ERR = "\x1b[31m[test.repo]\x1b[0m";

/**
 * Crea un test y vincula la lista de preguntas con su orden.
 *
 * @param {object} t
 * @param {string} t.nombre
 * @param {string|null} t.descripcion
 * @param {boolean} t.ordenAleatorio
 * @param {number} t.creadoPor
 * @param {number|null} t.cursoOrigenId
 * @param {Array<{preguntaId:number, orden:number}>} t.preguntas
 * @returns {Promise<number>} test_id
 */
async function crearTestConPreguntas(t) {
    const pool = db.getPool("auris");
    const tx = new db.sql.Transaction(pool);
    await tx.begin();
    try {
        const reqT = new db.sql.Request(tx);
        const r = await reqT
            .input("nombre", db.sql.NVarChar(200), t.nombre)
            .input("descripcion", db.sql.NVarChar(1000), t.descripcion || null)
            .input("orden_aleatorio", db.sql.Bit, t.ordenAleatorio ? 1 : 0)
            .input("creado_por", db.sql.BigInt, t.creadoPor)
            .input("curso_origen_id", db.sql.BigInt, t.cursoOrigenId || null)
            .query(`
                INSERT INTO auris.test
                    (nombre, descripcion, orden_aleatorio,
                     creado_por, curso_origen_id)
                OUTPUT INSERTED.test_id
                VALUES (@nombre, @descripcion, @orden_aleatorio,
                        @creado_por, @curso_origen_id);
            `);
        const testId = r.recordset[0].test_id;

        for (const tp of t.preguntas) {
            const reqTP = new db.sql.Request(tx);
            await reqTP
                .input("test_id", db.sql.BigInt, testId)
                .input("pregunta_id", db.sql.BigInt, tp.preguntaId)
                .input("orden", db.sql.SmallInt, tp.orden)
                .query(`
                    INSERT INTO auris.test_pregunta (test_id, pregunta_id, orden)
                    VALUES (@test_id, @pregunta_id, @orden);
                `);
        }

        await tx.commit();
        return testId;
    } catch (e) {
        logger.log(`${TAG_ERR} crearTestConPreguntas rollback: ${e.message}`, e);
        try { await tx.rollback(); } catch (_) {}
        throw e;
    }
}

/**
 * Lista tests creados por un profesor (o todos si null).
 */
async function listarPorProfesor(profesorId) {
    const r = await db
        .request("auris")
        .input("profesor_id", db.sql.BigInt, profesorId || null)
        .query(`
            SELECT  t.test_id,
                    t.nombre,
                    t.descripcion,
                    t.orden_aleatorio,
                    t.curso_origen_id,
                    c.nombre        AS curso_nombre,
                    t.activo,
                    t.created_at,
                    (SELECT COUNT(*) FROM auris.test_pregunta tp
                     WHERE tp.test_id = t.test_id) AS cantidad_preguntas
            FROM    auris.test t
            LEFT JOIN auris.curso c ON c.curso_id = t.curso_origen_id
            WHERE   t.activo = 1
              AND  (@profesor_id IS NULL OR t.creado_por = @profesor_id)
            ORDER BY t.created_at DESC;
        `);
    return r.recordset;
}

/**
 * Devuelve un test con sus preguntas (incluye alternativas completas).
 * Usado por la página test-detalle para gestionar las preguntas dentro
 * del test.
 */
async function obtenerConPreguntas(testId) {
    const pool = db.getPool("auris");

    const rTest = await pool
        .request()
        .input("test_id", db.sql.BigInt, testId)
        .query(`
            SELECT  test_id, nombre, descripcion, orden_aleatorio,
                    creado_por, curso_origen_id, clonado_de_id,
                    activo, created_at, updated_at
            FROM    auris.test
            WHERE   test_id = @test_id;
        `);
    if (rTest.recordset.length === 0) return null;

    const rPregs = await pool
        .request()
        .input("test_id", db.sql.BigInt, testId)
        .query(`
            SELECT  tp.pregunta_id,
                    tp.orden,
                    p.enunciado,
                    p.explicacion_clinica,
                    p.audio_grid_id,
                    p.imagen_grid_id,
                    p.video_grid_id,
                    (SELECT COUNT(*) FROM auris.alternativa a
                      WHERE a.pregunta_id = p.pregunta_id) AS cantidad_alternativas
            FROM    auris.test_pregunta tp
            JOIN    auris.pregunta p ON p.pregunta_id = tp.pregunta_id
            WHERE   tp.test_id = @test_id
              AND   p.activo = 1
            ORDER BY tp.orden;
        `);

    const test = rTest.recordset[0];
    test.preguntas = rPregs.recordset;
    return test;
}

/**
 * Verifica que un conjunto de pregunta_ids existan y estén activas.
 * Devuelve los ids encontrados (subset del input).
 */
async function existenPreguntas(preguntaIds) {
    if (!preguntaIds || preguntaIds.length === 0) return [];

    const pool = db.getPool("auris");
    const req = pool.request();
    const placeholders = preguntaIds.map((_, i) => {
        const k = `p${i}`;
        req.input(k, db.sql.BigInt, preguntaIds[i]);
        return `@${k}`;
    });
    const r = await req.query(`
        SELECT pregunta_id
        FROM   auris.pregunta
        WHERE  activo = 1
          AND  pregunta_id IN (${placeholders.join(",")});
    `);
    return r.recordset.map((x) => Number(x.pregunta_id));
}

module.exports = {
    crearTestConPreguntas,
    listarPorProfesor,
    obtenerConPreguntas,
    existenPreguntas,
};
