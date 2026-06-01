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
var audit = require("../repositories/auditoria.repository");
// Bloque P3.R9: utilidades compartidas
var { leerArg, validarLongitudes } = require("../../base/utils/argReader");

const TAG = "\x1b[36m[pregunta]\x1b[0m";
const TAG_ERR = "\x1b[31m[pregunta]\x1b[0m";

const GRID_ID_RE = /^[a-fA-F0-9]{24}$/;

function _leerArg(request) { return leerArg(request, { tag: TAG_ERR }); }

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
        // Límite del esquema: alternativa.texto NVARCHAR(1000)
        if (a.texto.length > 1000) {
            return `Alternativa #${i + 1}: texto no puede superar 1000 caracteres`;
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

/** Límites: enunciado NVARCHAR(2000), explicacion_clinica NVARCHAR(4000). */
function _validarLongitudPregunta(enunciado, explicacionClinica) {
    return validarLongitudes([
        { valor: enunciado,          max: 2000, etiqueta: "El enunciado" },
        { valor: explicacionClinica, max: 4000, etiqueta: "La explicación clínica" },
    ]);
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
        if (b.videoGridId && !GRID_ID_RE.test(b.videoGridId)) {
            logger.log(`${TAG} crear: videoGridId inválido (${b.videoGridId})`);
            return response.json(
                reply.error("videoGridId inválido (debe ser ObjectId hex 24)")
            );
        }

        const errLong = _validarLongitudPregunta(b.enunciado, b.explicacionClinica);
        if (errLong) {
            logger.log(`${TAG} crear: validación longitud falló — ${errLong}`);
            return response.json(reply.error(errLong));
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
            videoGridId: b.videoGridId || null,
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

    // Paginación opcional (escalabilidad). Con pageSize > 0 devuelve un envelope
    // { items, page, pageSize, hasMore }; sin él, un array (compatible hacia atrás).
    const ps = Number(b.pageSize);
    const pg = Number(b.page);
    const paginar = Number.isInteger(ps) && ps > 0;
    const pageSize = paginar ? Math.min(ps, 100) : null;
    const page = paginar && Number.isInteger(pg) && pg > 0 ? pg : 1;

    logger.log(`${TAG} listar: profesorId=${profesorId || 'todos'}${paginar ? ` page=${page} size=${pageSize}` : ''}`);
    try {
        if (paginar) {
            const offset = (page - 1) * pageSize;
            const rows = await preguntaRepo.listarPorProfesor(profesorId, { limit: pageSize + 1, offset });
            const hasMore = rows.length > pageSize;
            const items = hasMore ? rows.slice(0, pageSize) : rows;
            logger.log(`${TAG} listar: OK (page ${page}, ${items.length} filas, hasMore=${hasMore})`);
            return response.json(reply.ok({ items, page, pageSize, hasMore }));
        }
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
        // Autorización (RNF-19): un profesor solo accede a SUS preguntas (esta
        // respuesta incluye cuál es la correcta). El profesorId lo inyecta el
        // controlador desde el JWT. Si no es el dueño, "no encontrada".
        const profesorId = Number(b.profesorId);
        if (
            Number.isInteger(profesorId) && profesorId > 0 &&
            Number(data.creado_por) !== profesorId
        ) {
            logger.log(`${TAG} obtener: DENEGADO id=${preguntaId} dueño=${data.creado_por} solicita=${profesorId}`);
            return response.json(reply.error("Pregunta no encontrada"));
        }
        logger.log(`${TAG} obtener: OK id=${preguntaId}`);
        response.json(reply.ok(data));
    } catch (e) {
        logger.log(`${TAG_ERR} obtener: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

async function editar(request, response) {
    const b = _leerArg(request);
    const preguntaId = Number(b.preguntaId);
    const creadoPor = Number(b.creadoPor); // viene del JWT a través del controlador
    logger.log(`${TAG} editar: preguntaId=${preguntaId} creadoPor=${creadoPor}`);
    try {
        if (!Number.isInteger(preguntaId) || preguntaId <= 0)
            return response.json(reply.error("preguntaId requerido"));
        if (!b.enunciado || typeof b.enunciado !== "string")
            return response.json(reply.error("enunciado requerido"));
        if (!b.explicacionClinica || typeof b.explicacionClinica !== "string")
            return response.json(reply.error("explicacionClinica requerida (RF-63)"));
        if (b.audioGridId && !GRID_ID_RE.test(b.audioGridId))
            return response.json(reply.error("audioGridId inválido"));
        if (b.imagenGridId && !GRID_ID_RE.test(b.imagenGridId))
            return response.json(reply.error("imagenGridId inválido"));
        if (b.videoGridId && !GRID_ID_RE.test(b.videoGridId))
            return response.json(reply.error("videoGridId inválido"));

        const errLong = _validarLongitudPregunta(b.enunciado, b.explicacionClinica);
        if (errLong) return response.json(reply.error(errLong));

        const errAlts = _validarAlternativas(b.alternativas);
        if (errAlts) return response.json(reply.error(errAlts));

        const res = await preguntaRepo.editarPreguntaConAlternativas(
            preguntaId,
            {
                enunciado: b.enunciado.trim(),
                explicacionClinica: b.explicacionClinica.trim(),
                audioGridId: b.audioGridId || null,
                imagenGridId: b.imagenGridId || null,
                videoGridId: b.videoGridId || null,
                alternativas: b.alternativas.map((a) => ({
                    texto: a.texto.trim(),
                    esCorrecta: a.esCorrecta === true,
                    orden: a.orden,
                })),
            },
            Number.isInteger(creadoPor) && creadoPor > 0 ? creadoPor : null
        );

        if (!res.ok) {
            logger.log(`${TAG} editar: no se actualizó (${res.reason})`);
            // P2.R8: si está bloqueada por evaluaciones finalizadas, sugerimos clonar.
            if (res.reason === "LOCKED") {
                return response.json(reply.error(
                    `Esta pregunta ya tiene ${res.evaluacionesFinalizadas} evaluación(es) `
                    + `finalizada(s) y no puede modificarse. Duplica la pregunta y edita la copia.`
                ));
            }
            const msg =
                res.reason === "FORBIDDEN"
                    ? "Solo el creador puede editar esta pregunta"
                    : "Pregunta no encontrada";
            return response.json(reply.error(msg));
        }

        // P2.R8: registrar auditoría con before/after de los campos textuales.
        const cambios = audit.diff(res.antes, {
            enunciado: b.enunciado,
            explicacion_clinica: b.explicacionClinica,
            audio_grid_id: b.audioGridId || null,
            imagen_grid_id: b.imagenGridId || null,
            video_grid_id: b.videoGridId || null,
        }, ["enunciado","explicacion_clinica","audio_grid_id","imagen_grid_id","video_grid_id"]);

        if (Object.keys(cambios).length > 0) {
            await audit.registrar({
                usuarioId: creadoPor,
                accion: "PREGUNTA_EDITADA",
                entidad: "pregunta",
                entidadId: preguntaId,
                detalle: { cambios, alternativas_reemplazadas: true },
                ipOrigen: request.ip || null,
            });
        }

        logger.log(`${TAG} editar: OK pregunta_id=${preguntaId}`);
        response.json(reply.ok({ pregunta_id: preguntaId }));
    } catch (e) {
        logger.log(`${TAG_ERR} editar: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

async function eliminar(request, response) {
    const b = _leerArg(request);
    const preguntaId = Number(b.preguntaId);
    const creadoPor = Number(b.creadoPor);
    logger.log(`${TAG} eliminar: preguntaId=${preguntaId} creadoPor=${creadoPor}`);
    try {
        if (!Number.isInteger(preguntaId) || preguntaId <= 0)
            return response.json(reply.error("preguntaId requerido"));

        const res = await preguntaRepo.eliminarPregunta(
            preguntaId,
            Number.isInteger(creadoPor) && creadoPor > 0 ? creadoPor : null
        );

        if (!res.ok) {
            logger.log(`${TAG} eliminar: no se eliminó (${res.reason})`);
            const msg =
                res.reason === "FORBIDDEN"
                    ? "Solo el creador puede eliminar esta pregunta"
                    : res.reason === "ALREADY_INACTIVE"
                    ? "La pregunta ya estaba eliminada"
                    : "Pregunta no encontrada";
            return response.json(reply.error(msg));
        }

        // P2.R8: registrar la eliminación en el log de auditoría.
        await audit.registrar({
            usuarioId: creadoPor,
            accion: "PREGUNTA_ELIMINADA",
            entidad: "pregunta",
            entidadId: preguntaId,
            detalle: { tests_desvinculados: res.tests_desvinculados || 0 },
            ipOrigen: request.ip || null,
        });

        logger.log(`${TAG} eliminar: OK pregunta_id=${preguntaId} tests_desvinculados=${res.tests_desvinculados || 0}`);
        response.json(reply.ok({
            pregunta_id: preguntaId,
            tests_desvinculados: res.tests_desvinculados || 0,
        }));
    } catch (e) {
        logger.log(`${TAG_ERR} eliminar: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/**
 * Crea una pregunta y la vincula a un test, todo en uno.
 * Body: { testId, enunciado, explicacionClinica, alternativas, audioGridId?, imagenGridId? }
 */
async function agregarATest(request, response) {
    const b = _leerArg(request);
    const testId = Number(b.testId);
    const creadoPor = Number(b.creadoPor);
    logger.log(`${TAG} agregarATest: testId=${testId} creadoPor=${creadoPor}`);
    try {
        if (!Number.isInteger(testId) || testId <= 0)
            return response.json(reply.error("testId requerido"));
        if (!Number.isInteger(creadoPor) || creadoPor <= 0)
            return response.json(reply.error("creadoPor requerido"));
        if (!b.enunciado || typeof b.enunciado !== "string")
            return response.json(reply.error("enunciado requerido"));
        if (!b.explicacionClinica || typeof b.explicacionClinica !== "string")
            return response.json(reply.error("explicacionClinica requerida"));
        if (b.audioGridId && !GRID_ID_RE.test(b.audioGridId))
            return response.json(reply.error("audioGridId inválido"));
        if (b.imagenGridId && !GRID_ID_RE.test(b.imagenGridId))
            return response.json(reply.error("imagenGridId inválido"));
        if (b.videoGridId && !GRID_ID_RE.test(b.videoGridId))
            return response.json(reply.error("videoGridId inválido"));

        const errLong = _validarLongitudPregunta(b.enunciado, b.explicacionClinica);
        if (errLong) return response.json(reply.error(errLong));

        const errAlts = _validarAlternativas(b.alternativas);
        if (errAlts) return response.json(reply.error(errAlts));

        // 1) Crear la pregunta
        const preguntaId = await preguntaRepo.crearPreguntaConAlternativas({
            enunciado: b.enunciado.trim(),
            explicacionClinica: b.explicacionClinica.trim(),
            audioGridId: b.audioGridId || null,
            imagenGridId: b.imagenGridId || null,
            videoGridId: b.videoGridId || null,
            creadoPor: creadoPor,
            cursoOrigenId: null,
            alternativas: b.alternativas.map((a) => ({
                texto: a.texto.trim(),
                esCorrecta: a.esCorrecta === true,
                orden: a.orden,
            })),
        });

        // 2) Vincularla al test
        const orden = await preguntaRepo.vincularATest(preguntaId, testId);

        logger.log(`${TAG} agregarATest: OK preguntaId=${preguntaId} orden=${orden}`);
        response.json(reply.ok({ pregunta_id: preguntaId, orden: orden }));
    } catch (e) {
        logger.log(`${TAG_ERR} agregarATest: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/**
 * Desvincula una pregunta de un test. Si la pregunta queda huérfana,
 * la marca como inactiva (soft delete).
 */
async function quitarDeTest(request, response) {
    const b = _leerArg(request);
    const testId = Number(b.testId);
    const preguntaId = Number(b.preguntaId);
    logger.log(`${TAG} quitarDeTest: testId=${testId} preguntaId=${preguntaId}`);
    try {
        if (!Number.isInteger(testId) || testId <= 0)
            return response.json(reply.error("testId requerido"));
        if (!Number.isInteger(preguntaId) || preguntaId <= 0)
            return response.json(reply.error("preguntaId requerido"));

        const res = await preguntaRepo.desvincularDeTest(preguntaId, testId);
        logger.log(`${TAG} quitarDeTest: OK huerfanaEliminada=${res.huerfanaEliminada}`);
        response.json(reply.ok({ huerfanaEliminada: res.huerfanaEliminada }));
    } catch (e) {
        logger.log(`${TAG_ERR} quitarDeTest: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/* =============================================================================
   Export del banco a CSV (Bloque P3.R10 — auditoría ISO 25010, reemplazabilidad).
   GET /preguntas/exportarBanco?profesorId=...
   Devuelve text/csv listo para descarga. Una fila por alternativa.
   ============================================================================= */

function _csvEscape(s) {
    if (s == null) return "";
    const str = String(s);
    if (/[",\n\r]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

async function exportarBanco(request, response) {
    const b = _leerArg(request);
    const profesorId = b.profesorId ? Number(b.profesorId) : null;
    logger.log(`${TAG} exportarBanco: profesorId=${profesorId || 'todos'}`);
    try {
        const data = await preguntaRepo.exportarBanco(profesorId);
        const cols = [
            "pregunta_id", "enunciado", "explicacion_clinica",
            "curso_codigo", "audio_grid_id", "imagen_grid_id", "video_grid_id",
            "creado_por_correo", "created_at", "updated_at",
            "alt_orden", "alt_texto", "es_correcta",
        ];
        const lines = [cols.join(",")];
        for (const p of data) {
            const alts = p.alternativas || [];
            if (alts.length === 0) {
                lines.push(cols.map((c) => _csvEscape(p[c])).join(","));
            } else {
                for (const a of alts) {
                    lines.push([
                        _csvEscape(p.pregunta_id),
                        _csvEscape(p.enunciado),
                        _csvEscape(p.explicacion_clinica),
                        _csvEscape(p.curso_codigo),
                        _csvEscape(p.audio_grid_id),
                        _csvEscape(p.imagen_grid_id),
                        _csvEscape(p.video_grid_id),
                        _csvEscape(p.creado_por_correo),
                        _csvEscape(p.created_at),
                        _csvEscape(p.updated_at),
                        _csvEscape(a.orden),
                        _csvEscape(a.texto),
                        _csvEscape(a.es_correcta ? "1" : "0"),
                    ].join(","));
                }
            }
        }
        const csv = "﻿" + lines.join("\n");
        const filename = `auris_banco_${new Date().toISOString().slice(0,10)}.csv`;
        response.setHeader("Content-Type", "text/csv; charset=utf-8");
        response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        response.send(csv);
    } catch (e) {
        logger.log(`${TAG_ERR} exportarBanco: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

module.exports = {
    crear,
    listar,
    obtener,
    editar,
    eliminar,
    agregarATest,
    quitarDeTest,
    exportarBanco,
};
