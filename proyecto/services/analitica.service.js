"use strict";

/**
 * Service de analítica docente (RF-94 a RF-104).
 */

var reply = require("../../base/utils/reply");
var analiticaRepo = require("../repositories/analitica.repository");

const TAG = "\x1b[36m[analitica]\x1b[0m";
const TAG_ERR = "\x1b[31m[analitica]\x1b[0m";

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
 * POST /base_logica/analitica/resumen   body.arg = { profesorId }
 * Lista las aplicaciones del profesor con su resumen estadístico.
 */
async function resumen(request, response) {
    const b = _leerArg(request);
    const profesorId = Number(b.profesorId);
    logger.log(`${TAG} resumen: profesorId=${profesorId}`);
    try {
        if (!Number.isInteger(profesorId) || profesorId <= 0)
            return response.json(reply.error("profesorId requerido"));

        const data = await analiticaRepo.resumenPorProfesor(profesorId);
        logger.log(`${TAG} resumen: OK (${data.length} aplicaciones)`);
        response.json(reply.ok(data));
    } catch (e) {
        logger.log(`${TAG_ERR} resumen: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/**
 * POST /base_logica/analitica/aplicacion   body.arg = { aplicacionId }
 * Devuelve: resumen global + preguntas por tasa de error + evaluaciones.
 */
async function detalleAplicacion(request, response) {
    const b = _leerArg(request);
    const aplicacionId = Number(b.aplicacionId);
    logger.log(`${TAG} detalleAplicacion: aplicacionId=${aplicacionId}`);
    try {
        if (!Number.isInteger(aplicacionId) || aplicacionId <= 0)
            return response.json(reply.error("aplicacionId requerido"));

        const resumenApl = await analiticaRepo.resumenAplicacion(aplicacionId);
        if (!resumenApl) {
            return response.json(reply.error("Aplicación no encontrada"));
        }
        const preguntas = await analiticaRepo.preguntasPorAplicacion(aplicacionId);
        const evaluaciones = await analiticaRepo.evaluacionesPorAplicacion(aplicacionId);

        logger.log(`${TAG} detalleAplicacion: OK (${preguntas.length} preguntas, ${evaluaciones.length} evals)`);
        response.json(
            reply.ok({
                resumen: resumenApl,
                preguntas: preguntas,
                evaluaciones: evaluaciones,
            })
        );
    } catch (e) {
        logger.log(`${TAG_ERR} detalleAplicacion: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

module.exports = {
    resumen,
    detalleAplicacion,
};
