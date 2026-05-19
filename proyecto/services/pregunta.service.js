"use strict";

/**
 * Service de preguntas (módulo docente).
 * Cubre RF-62, RF-63, RF-64, RF-65, RF-66.
 *
 * TODO(auth): cuando exista middleware JWT (RNF-19), reemplazar
 * `params.creadoPor` proveniente del body por `request.usuario.usuario_id`.
 */

var reply = require("../../base/utils/reply");
var preguntaRepo = require("../repositories/pregunta.repository");

const TAG = "\x1b[36m[pregunta]\x1b[0m";
const TAG_ERR = "\x1b[31m[pregunta]\x1b[0m";

const GRID_ID_RE = /^[a-fA-F0-9]{24}$/;

/**
 * El controlador envía el body como `arg=<JSON urlencoded>`. Desempacamos
 * para obtener los params reales. Si llega JSON puro (test directo), también
 * funciona.
 */
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

function _validarAlternativas(alternativas) {
    if (!Array.isArray(alternativas)) {
        return "alternativas debe ser un arreglo";
    }
    if (alternativas.length < 2 || alternativas.length > 5) {
        return "Una pregunta debe tener entre 2 y 5 alternativas (RF-65)";
    }
    const correctas = alternativas.filter((a) => a && a.esCorrecta === true);
    if (correctas.length !== 1) {
        return "Debe haber exactamente 1 alternativa correcta (RF-66)";
    }
    const ordenes = new Set();
    for (let i = 0; i < alternativas.length; i++) {
        const a = alternativas[i];
        if (!a || typeof a.texto !== "string" || a.texto.trim() === "") {
            return `Alternativa #${i + 1}: texto requerido`;
        }
        if (!Number.isInteger(a.orden) || a.orden < 1 || a.orden > 5) {
            return `Alternativa #${i + 1}: orden debe ser entero entre 1 y 5`;
        }
        if (ordenes.has(a.orden)) {
            return `Alternativa #${i + 1}: orden ${a.orden} duplicado`;
        }
        ordenes.add(a.orden);
    }
    return null;
}

async function crear(request, response) {
    const b = _leerArg(request);
    const creadoPor = Number(b.creadoPor);
    logger.log(`${TAG} crear: prof=${b.creadoPor} (typeof=${typeof b.creadoPor}) coerced=${creadoPor} alts=${(b.alternativas || []).length}`);
    try {
        if (!b.enunciado || typeof b.enunciado !== "string") {
            logger.log(`${TAG} crear: validación falló — enunciado vacío`);
            return response.json(reply.error("enunciado requerido"));
        }
        if (!b.explicacionClinica || typeof b.explicacionClinica !== "string") {
            logger.log(`${TAG} crear: validación falló — explicacionClinica vacía`);
            return response.json(
                reply.error("explicacionClinica requerida (RF-63)")
            );
        }
        if (!Number.isInteger(creadoPor) || creadoPor <= 0) {
            logger.log(`${TAG} crear: validación falló — creadoPor inválido (${b.creadoPor})`);
            return response.json(reply.error("creadoPor (usuario_id) requerido"));
        }
        if (b.audioGridId && !GRID_ID_RE.test(b.audioGridId)) {
            logger.log(`${TAG} crear: audioGridId inválido (${b.audioGridId})`);
            return response.json(
                reply.error("audioGridId inválido (debe ser ObjectId hex 24)")
            );
        }
        if (b.imagenGridId && !GRID_ID_RE.test(b.imagenGridId)) {
            logger.log(`${TAG} crear: imagenGridId inválido (${b.imagenGridId})`);
            return response.json(
                reply.error("imagenGridId inválido (debe ser ObjectId hex 24)")
            );
        }

        const errAlts = _validarAlternativas(b.alternativas);
        if (errAlts) {
            logger.log(`${TAG} crear: validación alternativas falló — ${errAlts}`);
            return response.json(reply.error(errAlts));
        }

        const preguntaId = await preguntaRepo.crearPreguntaConAlternativas({
            enunciado: b.enunciado.trim(),
            explicacionClinica: b.explicacionClinica.trim(),
            audioGridId: b.audioGridId || null,
            imagenGridId: b.imagenGridId || null,
            creadoPor: creadoPor,
            cursoOrigenId: b.cursoOrigenId ? Number(b.cursoOrigenId) : null,
            alternativas: b.alternativas.map((a) => ({
                texto: a.texto.trim(),
                esCorrecta: a.esCorrecta === true,
                orden: a.orden,
            })),
        });

        logger.log(`${TAG} crear: OK pregunta_id=${preguntaId}`);
        response.json(reply.ok({ pregunta_id: preguntaId }));
    } catch (e) {
        logger.log(`${TAG_ERR} crear: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

async function listar(request, response) {
    const b = _leerArg(request);
    const coerced = Number(b.profesorId);
    const profesorId = Number.isInteger(coerced) && coerced > 0 ? coerced : null;
    logger.log(`${TAG} listar: profesorId=${profesorId || 'todos'}`);
    try {
        const data = await preguntaRepo.listarPorProfesor(profesorId);
        logger.log(`${TAG} listar: OK (${data.length} filas)`);
        response.json(reply.ok(data));
    } catch (e) {
        logger.log(`${TAG_ERR} listar: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

async function obtener(request, response) {
    const b = _leerArg(request);
    const preguntaId = Number(b.preguntaId);
    logger.log(`${TAG} obtener: preguntaId=${b.preguntaId} coerced=${preguntaId}`);
    try {
        if (!Number.isInteger(preguntaId) || preguntaId <= 0) {
            logger.log(`${TAG} obtener: validación falló — preguntaId inválido`);
            return response.json(reply.error("preguntaId requerido"));
        }
        const data = await preguntaRepo.obtenerConAlternativas(preguntaId);
        if (!data) {
            logger.log(`${TAG} obtener: no encontrada (id=${preguntaId})`);
            return response.json(reply.error("Pregunta no encontrada"));
        }
        logger.log(`${TAG} obtener: OK id=${preguntaId}`);
        response.json(reply.ok(data));
    } catch (e) {
        logger.log(`${TAG_ERR} obtener: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

module.exports = {
    crear,
    listar,
    obtener,
};
