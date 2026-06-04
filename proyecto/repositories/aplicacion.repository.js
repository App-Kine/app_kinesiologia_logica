"use strict";

/**
 * Repositorio de aplicaciones de test (auris.aplicacion_test).
 * Cubre RF-71, RF-72, RF-88 a RF-93.
 *
 * Nota: la unicidad (curso_id, test_id) la garantiza la constraint
 * UQ_apl_curso_test; aquí capturamos el error 2627/2601 para devolver
 * un mensaje legible.
 */

var db = require("../../base/utils/db");

const TAG_ERR = "\x1b[31m[aplicacion.repo]\x1b[0m";

/**
 * Verifica si un profesor está asignado activamente a un curso.
 * Soporta RF-71 (asignar a cursos autorizados).
 */
async function profesorPerteneceACurso(profesorId, cursoId) {
    const r = await db
        .request("auris")
        .input("usuario_id", db.sql.BigInt, profesorId)
        .input("curso_id", db.sql.BigInt, cursoId)
        .query(`
            SELECT  1 AS ok
            FROM    auris.profesor_curso
            WHERE   usuario_id = @usuario_id
              AND   curso_id   = @curso_id
              AND   activo     = 1;
        `);
    return r.recordset.length > 0;
}

/**
 * Crea una aplicación de test. Devuelve { aplicacion_id, aplicacion_uuid }.
 */
async function crearAplicacion(testId, cursoId, profesorId) {
    try {
        const r = await db
            .request("auris")
            .input("test_id", db.sql.BigInt, testId)
            .input("curso_id", db.sql.BigInt, cursoId)
            .input("profesor_id", db.sql.BigInt, profesorId)
            .query(`
                INSERT INTO auris.aplicacion_test
                    (test_id, curso_id, profesor_id)
                OUTPUT INSERTED.aplicacion_id, INSERTED.aplicacion_uuid
                VALUES (@test_id, @curso_id, @profesor_id);
            `);
        return r.recordset[0];
    } catch (e) {
        // 2627/2601 = unique key violation
        if (e.number === 2627 || e.number === 2601) {
            const err = new Error(
                "Ya existe una aplicación de este test en este curso"
            );
            err.code = "DUPLICATE";
            throw err;
        }
        logger.log(`${TAG_ERR} crearAplicacion: ${e.message}`, e);
        throw e;
    }
}

/**
 * Lista aplicaciones por profesor responsable y/o curso.
 * Ambos parámetros son opcionales: null = sin filtro por ese campo.
 *
 * Paginación opcional (escalabilidad): si `opciones.limit` es un entero > 0 se
 * agrega OFFSET/FETCH NEXT. Sin opciones, devuelve TODO (compatible hacia atrás).
 */
async function listarPorProfesor(profesorId, cursoId, opciones = {}) {
    const { limit, offset } = opciones;
    const paginar = Number.isInteger(limit) && limit > 0;

    const req = db
        .request("auris")
        .input("profesor_id", db.sql.BigInt, profesorId || null)
        .input("curso_id", db.sql.BigInt, cursoId || null);

    let paginacionSql = "";
    if (paginar) {
        req.input("offset", db.sql.Int, Number.isInteger(offset) && offset > 0 ? offset : 0);
        req.input("limit", db.sql.Int, limit);
        paginacionSql = "OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY";
    }

    const r = await req.query(`
            SELECT  a.aplicacion_id,
                    a.aplicacion_uuid,
                    a.test_id,
                    t.nombre        AS test_nombre,
                    a.curso_id,
                    c.codigo        AS curso_codigo,
                    c.nombre        AS curso_nombre,
                    a.profesor_id,
                    a.activo,
                    a.visible_desde,
                    a.visible_hasta,
                    a.created_at
            FROM    auris.aplicacion_test a
            JOIN    auris.test t  ON t.test_id = a.test_id
            JOIN    auris.curso c ON c.curso_id = a.curso_id
            WHERE   (@profesor_id IS NULL OR a.profesor_id = @profesor_id)
              AND   (@curso_id IS NULL OR a.curso_id = @curso_id)
              AND   t.activo = 1
              AND   c.activo = 1
            ORDER BY a.created_at DESC
            ${paginacionSql};
        `);
    return r.recordset;
}

/**
 * Activa o desactiva una aplicación (RF-91).
 *
 * profesorId (opcional): si se entrega, el UPDATE solo afecta a la aplicación
 * cuando pertenece a ese profesor (RNF-19 — evita write-IDOR: pausar/activar
 * la aplicación de otro docente). Si es null, no se filtra por dueño.
 */
async function setActivo(aplicacionId, activo, profesorId) {
    const r = await db
        .request("auris")
        .input("aplicacion_id", db.sql.BigInt, aplicacionId)
        .input("activo", db.sql.Bit, activo ? 1 : 0)
        .input("profesor_id", db.sql.BigInt, profesorId || null)
        .query(`
            UPDATE auris.aplicacion_test
            SET    activo = @activo,
                   updated_at = SYSUTCDATETIME()
            WHERE  aplicacion_id = @aplicacion_id
              AND  (@profesor_id IS NULL OR profesor_id = @profesor_id);
            SELECT @@ROWCOUNT AS filas;
        `);
    return r.recordset[0].filas > 0;
}

module.exports = {
    profesorPerteneceACurso,
    crearAplicacion,
    listarPorProfesor,
    setActivo,
};
