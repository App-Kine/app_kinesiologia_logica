"use strict";

/**
 * Service de analítica docente (RF-94 a RF-104).
 */

var reply = require("../../base/utils/reply");
var analiticaRepo = require("../repositories/analitica.repository");
// Bloque P3.R9: utilidades compartidas
var { leerArg } = require("../../base/utils/argReader");

const TAG = "\x1b[36m[analitica]\x1b[0m";
const TAG_ERR = "\x1b[31m[analitica]\x1b[0m";

function _leerArg(request) { return leerArg(request, { tag: TAG_ERR }); }

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
    // Autorización (RNF-19): el profesorId lo inyecta el controlador desde el
    // JWT verificado. El chequeo de propiedad es SIEMPRE obligatorio: si falta
    // profesorId no devolvemos datos (evita IDOR).
    const profesorId = Number(b.profesorId);
    logger.log(`${TAG} detalleAplicacion: aplicacionId=${aplicacionId} profesorId=${profesorId}`);
    try {
        if (!Number.isInteger(aplicacionId) || aplicacionId <= 0)
            return response.json(reply.error("aplicacionId requerido"));

        if (!Number.isInteger(profesorId) || profesorId <= 0)
            return response.json(reply.error("No autorizado"));

        const resumenApl = await analiticaRepo.resumenAplicacion(aplicacionId);
        if (!resumenApl) {
            return response.json(reply.error("Aplicación no encontrada"));
        }
        // Un profesor solo ve la analítica de SUS aplicaciones.
        if (Number(resumenApl.profesor_id) !== profesorId) {
            logger.log(`${TAG} detalleAplicacion: DENEGADO aplicacionId=${aplicacionId} dueño=${resumenApl.profesor_id} solicita=${profesorId}`);
            return response.json(reply.error("Aplicación no encontrada"));
        }
        // Las 3 consultas restantes son independientes entre sí (ya validada la
        // propiedad arriba): las ejecutamos en paralelo para reducir latencia.
        const [preguntas, evaluaciones, tiemposIdentificados] = await Promise.all([
            analiticaRepo.preguntasPorAplicacion(aplicacionId),
            analiticaRepo.evaluacionesPorAplicacion(aplicacionId),
            analiticaRepo.tiemposPorEvaluacionPregunta(aplicacionId),
        ]);

        logger.log(`${TAG} detalleAplicacion: OK (${preguntas.length} preguntas, ${evaluaciones.length} evals, ${tiemposIdentificados.length} timings)`);
        response.json(
            reply.ok({
                resumen: resumenApl,
                preguntas: preguntas,
                evaluaciones: evaluaciones,
                tiempos_identificados: tiemposIdentificados,
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
