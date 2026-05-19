"use strict";

/**
 * Service de tests (módulo docente).
 * Cubre RF-69 (crear test asociando preguntas con orden configurable).
 *
 * TODO(auth): cuando exista middleware JWT (RNF-19), tomar `creadoPor`
 * desde `request.usuario.usuario_id` en vez del body.
 */

var reply = require("../../base/utils/reply");
var testRepo = require("../repositories/test.repository");

const TAG = "\x1b[36m[test]\x1b[0m";
const TAG_ERR = "\x1b[31m[test]\x1b[0m";

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

function _validarComposicion(preguntas) {
    if (!Array.isArray(preguntas) || preguntas.length === 0) {
        return "El test debe incluir al menos 1 pregunta";
    }
    const ordenes = new Set();
    const ids = new Set();
    for (let i = 0; i < preguntas.length; i++) {
        const p = preguntas[i];
        if (!p || !Number.isInteger(p.preguntaId) || p.preguntaId <= 0) {
            return `Posición #${i + 1}: preguntaId inválido`;
        }
        if (!Number.isInteger(p.orden) || p.orden < 1) {
            return `Posición #${i + 1}: orden debe ser entero ≥ 1`;
        }
        if (ordenes.has(p.orden)) {
            return `Orden ${p.orden} duplicado`;
        }
        if (ids.has(p.preguntaId)) {
            return `preguntaId ${p.preguntaId} repetida en el test`;
        }
        ordenes.add(p.orden);
        ids.add(p.preguntaId);
    }
    return null;
}

async function crear(request, response) {
    const b = _leerArg(request);
    const creadoPor = Number(b.creadoPor);
    logger.log(`${TAG} crear: prof=${b.creadoPor} coerced=${creadoPor} nombre="${b.nombre}" preguntas=${(b.preguntas || []).length}`);
    try {
        if (!b.nombre || typeof b.nombre !== "string") {
            logger.log(`${TAG} crear: validación falló — nombre vacío`);
            return response.json(reply.error("nombre requerido"));
        }
        if (!Number.isInteger(creadoPor) || creadoPor <= 0) {
            logger.log(`${TAG} crear: validación falló — creadoPor inválido (${b.creadoPor})`);
            return response.json(reply.error("creadoPor (usuario_id) requerido"));
        }

        const errComp = _validarComposicion(b.preguntas);
        if (errComp) {
            logger.log(`${TAG} crear: validación composición falló — ${errComp}`);
            return response.json(reply.error(errComp));
        }

        const ids = b.preguntas.map((p) => p.preguntaId);
        const encontradas = await testRepo.existenPreguntas(ids);
        if (encontradas.length !== ids.length) {
            const faltantes = ids.filter((id) => !encontradas.includes(id));
            logger.log(`${TAG} crear: preguntas inexistentes/inactivas — [${faltantes.join(", ")}]`);
            return response.json(
                reply.error(
                    `Preguntas inexistentes o inactivas: ${faltantes.join(", ")}`
                )
            );
        }

        const testId = await testRepo.crearTestConPreguntas({
            nombre: b.nombre.trim(),
            descripcion: b.descripcion ? String(b.descripcion).trim() : null,
            ordenAleatorio: b.ordenAleatorio === true,
            creadoPor: creadoPor,
            cursoOrigenId: b.cursoOrigenId ? Number(b.cursoOrigenId) : null,
            preguntas: b.preguntas.map((p) => ({
                preguntaId: p.preguntaId,
                orden: p.orden,
            })),
        });

        logger.log(`${TAG} crear: OK test_id=${testId}`);
        response.json(reply.ok({ test_id: testId }));
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
        const data = await testRepo.listarPorProfesor(profesorId);
        logger.log(`${TAG} listar: OK (${data.length} filas)`);
        response.json(reply.ok(data));
    } catch (e) {
        logger.log(`${TAG_ERR} listar: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

async function obtener(request, response) {
    const b = _leerArg(request);
    const testId = Number(b.testId);
    logger.log(`${TAG} obtener: testId=${b.testId} coerced=${testId}`);
    try {
        if (!Number.isInteger(testId) || testId <= 0) {
            logger.log(`${TAG} obtener: validación falló — testId inválido`);
            return response.json(reply.error("testId requerido"));
        }
        const data = await testRepo.obtenerConPreguntas(testId);
        if (!data) {
            logger.log(`${TAG} obtener: no encontrado (id=${testId})`);
            return response.json(reply.error("Test no encontrado"));
        }
        logger.log(`${TAG} obtener: OK id=${testId}`);
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
