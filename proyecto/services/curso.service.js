"use strict";

/**
 * Service de cursos – consulta directa a AurisDB.
 * Sirve como referencia de cómo se accede a SQL Server desde un service.
 */

var reply = require("../../base/utils/reply");
var db = require("../../base/utils/db");

const TAG = "\x1b[36m[curso]\x1b[0m";
const TAG_ERR = "\x1b[31m[curso]\x1b[0m";

function _leerArg(request) {
    try {
        if (request.body && typeof request.body.arg === "string") {
            return JSON.parse(request.body.arg);
        }
        return request.body || {};
    } catch (e) {
        return {};
    }
}

/**
 * GET equivalente: POST /<rootPath>/cursos/listar
 * Lista los cursos activos visibles al estudiante (RF-02).
 */
async function listarActivos(request, response) {
    try {
        const r = await db
            .request("auris")
            .query(`
                SELECT  curso_id,
                        codigo,
                        nombre,
                        descripcion
                FROM    auris.curso
                WHERE   activo = 1
                ORDER BY codigo;
            `);

        response.json(reply.ok(r.recordset));
    } catch (e) {
        response.json(reply.fatal(e));
    }
}

/**
 * POST /<rootPath>/cursos/detalle  body: { curso_id }
 * Devuelve un curso por id usando parámetros SQL (anti-inyección).
 */
async function detalle(request, response) {
    try {
        const cursoId = request.body && request.body.curso_id;
        if (!cursoId) {
            return response.json(
                reply.error("Falta parámetro curso_id en el body")
            );
        }

        const r = await db
            .request("auris")
            .input("curso_id", db.sql.BigInt, cursoId)
            .query(`
                SELECT  curso_id,
                        codigo,
                        nombre,
                        descripcion,
                        activo,
                        created_at,
                        updated_at
                FROM    auris.curso
                WHERE   curso_id = @curso_id;
            `);

        if (r.recordset.length === 0) {
            return response.json(reply.error("Curso no encontrado"));
        }

        response.json(reply.ok(r.recordset[0]));
    } catch (e) {
        response.json(reply.fatal(e));
    }
}

/**
 * POST /<rootPath>/cursos/ping
 * Health-check de la conexión a la BD: hace SELECT 1.
 */
async function ping(request, response) {
    try {
        const r = await db
            .request("auris")
            .query("SELECT 1 AS ok, GETUTCDATE() AS servertime;");
        response.json(reply.ok(r.recordset[0]));
    } catch (e) {
        response.json(reply.fatal(e));
    }
}

/**
 * POST /<rootPath>/cursos/misCursos  body: { profesorId }
 * Devuelve los cursos donde el profesor está asignado activamente (RF-61).
 */
async function listarDelProfesor(request, response) {
    const b = _leerArg(request);
    const profesorId = Number(b.profesorId);
    logger.log(`${TAG} listarDelProfesor: profesorId=${b.profesorId} coerced=${profesorId}`);
    try {
        if (!Number.isInteger(profesorId) || profesorId <= 0) {
            logger.log(`${TAG} listarDelProfesor: validación falló — profesorId inválido`);
            return response.json(reply.error("profesorId requerido"));
        }
        const r = await db
            .request("auris")
            .input("profesor_id", db.sql.BigInt, profesorId)
            .query(`
                SELECT  c.curso_id,
                        c.codigo,
                        c.nombre,
                        c.descripcion
                FROM    auris.curso c
                JOIN    auris.profesor_curso pc
                          ON pc.curso_id = c.curso_id
                WHERE   pc.usuario_id = @profesor_id
                  AND   pc.activo = 1
                  AND   c.activo = 1
                ORDER BY c.codigo;
            `);
        logger.log(`${TAG} listarDelProfesor: OK (${r.recordset.length} filas)`);
        response.json(reply.ok(r.recordset));
    } catch (e) {
        logger.log(`${TAG_ERR} listarDelProfesor: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

module.exports = {
    listarActivos,
    detalle,
    ping,
    listarDelProfesor,
};
