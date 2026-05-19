"use strict";

/**
 * Service de cursos – consulta directa a AurisDB.
 * Sirve como referencia de cómo se accede a SQL Server desde un service.
 */

var reply = require("../../base/utils/reply");
var db = require("../../base/utils/db");

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

module.exports = {
    listarActivos,
    detalle,
    ping,
};
