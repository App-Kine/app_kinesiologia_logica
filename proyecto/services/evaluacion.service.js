"use strict";

/**
 * Service del flujo de evaluación del ESTUDIANTE (público, sin login).
 * Cubre RF-01..RF-44 (núcleo: sin modelo 3D ni informe por correo).
 *
 * La corrección es server-side; nunca se expone `es_correcta` al cargar
 * preguntas. La alternativa correcta + explicación se revelan sólo al
 * finalizar cada pregunta (RF-36/RF-38).
 */

var reply = require("../../base/utils/reply");
var mailer = require("../../base/utils/mailer");
var evalRepo = require("../repositories/evaluacion.repository");

const TAG = "\x1b[36m[evaluacion]\x1b[0m";
const TAG_ERR = "\x1b[31m[evaluacion]\x1b[0m";

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function _leerArg(request) {
    try {
        if (request.body && typeof request.body.arg === "string") {
            return JSON.parse(request.body.arg);
        }
        return request.body || {};
    } catch (e) {
        logger.log(`${TAG_ERR} _leerArg: arg JSON inválido — ${e.message}`);
        return {};
    }
}

/** POST /evaluacion/aplicacionesActivas  body: { cursoId } */
async function aplicacionesActivas(request, response) {
    const b = _leerArg(request);
    const cursoId = Number(b.cursoId);
    logger.log(`${TAG} aplicacionesActivas: cursoId=${b.cursoId}`);
    try {
        if (!Number.isInteger(cursoId) || cursoId <= 0) {
            return response.json(reply.error("cursoId requerido"));
        }
        const data = await evalRepo.listarAplicacionesActivasPorCurso(cursoId);
        logger.log(`${TAG} aplicacionesActivas: OK (${data.length} filas)`);
        response.json(reply.ok(data));
    } catch (e) {
        logger.log(`${TAG_ERR} aplicacionesActivas: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/**
 * POST /evaluacion/iniciar  body: { aplicacionId, modalidad, correo? }
 * Crea la evaluación y devuelve { evaluacion, preguntas } (RF-06..RF-14).
 */
async function iniciar(request, response) {
    const b = _leerArg(request);
    const aplicacionId = Number(b.aplicacionId);
    const modalidad = (b.modalidad || "").toUpperCase();
    const correo = b.correo ? String(b.correo).trim() : null;
    logger.log(`${TAG} iniciar: aplicacion=${b.aplicacionId} modalidad=${modalidad}`);
    try {
        if (!Number.isInteger(aplicacionId) || aplicacionId <= 0) {
            return response.json(reply.error("aplicacionId requerido"));
        }
        if (modalidad !== "ANONIMA" && modalidad !== "IDENTIFICADA") {
            return response.json(
                reply.error("modalidad debe ser ANONIMA o IDENTIFICADA")
            );
        }
        if (modalidad === "IDENTIFICADA") {
            if (!correo) return response.json(reply.error("correo requerido en modalidad IDENTIFICADA (RF-08)"));
            if (!RE_CORREO.test(correo)) return response.json(reply.error("Formato de correo inválido (RF-09)"));
        }

        const apl = await evalRepo.obtenerAplicacionActiva(aplicacionId);
        if (!apl) {
            return response.json(
                reply.error("La aplicación de test no está disponible (inactiva o inexistente)")
            );
        }

        const correoFinal = modalidad === "IDENTIFICADA" ? correo : null;
        const ev = await evalRepo.iniciarEvaluacion(aplicacionId, modalidad, correoFinal);
        const preguntas = await evalRepo.cargarPreguntas(apl.test_id, apl.orden_aleatorio === true || apl.orden_aleatorio === 1);

        if (preguntas.length === 0) {
            return response.json(reply.error("El test no tiene preguntas activas"));
        }

        logger.log(`${TAG} iniciar: OK evaluacion_id=${ev.evaluacion_id} preguntas=${preguntas.length}`);
        response.json(
            reply.ok({
                evaluacion_id: ev.evaluacion_id,
                evaluacion_uuid: ev.evaluacion_uuid,
                aplicacion_id: aplicacionId,
                test_nombre: apl.test_nombre,
                modalidad: modalidad,
                total_preguntas: preguntas.length,
                preguntas: preguntas,
            })
        );
    } catch (e) {
        logger.log(`${TAG_ERR} iniciar: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/**
 * POST /evaluacion/responder
 * body: { evaluacionId, preguntaId, alternativaId, intento, ordenPresentacion, tiempoSegundos? }
 * RF-25/26/31/32/34/35/36/38.
 *
 * `tiempoSegundos` (pedido cliente 2026-05-26): segundos en pantalla.
 * Solo se persiste cuando este intento finaliza la pregunta.
 */
async function responder(request, response) {
    const b = _leerArg(request);
    const evaluacionId = Number(b.evaluacionId);
    const preguntaId = Number(b.preguntaId);
    const alternativaId = Number(b.alternativaId);
    const intento = Number(b.intento);
    const ordenPresentacion = Number(b.ordenPresentacion) || 1;
    const tiempoSegundos = (b.tiempoSegundos != null && Number.isFinite(Number(b.tiempoSegundos)))
        ? Math.max(0, Math.round(Number(b.tiempoSegundos)))
        : null;
    logger.log(`${TAG} responder: eval=${evaluacionId} preg=${preguntaId} intento=${intento} tiempo=${tiempoSegundos}`);
    try {
        if (!Number.isInteger(evaluacionId) || evaluacionId <= 0)
            return response.json(reply.error("evaluacionId requerido"));
        if (!Number.isInteger(preguntaId) || preguntaId <= 0)
            return response.json(reply.error("preguntaId requerido"));
        if (!Number.isInteger(alternativaId) || alternativaId <= 0)
            return response.json(reply.error("alternativaId requerido"));
        if (intento !== 1 && intento !== 2)
            return response.json(reply.error("intento debe ser 1 o 2 (RF-31)"));

        const ev = await evalRepo.obtenerEvaluacion(evaluacionId);
        if (!ev) return response.json(reply.error("Evaluación no encontrada"));
        if (ev.estado !== "EN_CURSO")
            return response.json(reply.error("La evaluación ya está finalizada (RF-12)"));

        try {
            const res = await evalRepo.registrarRespuesta(
                evaluacionId, preguntaId, alternativaId, intento, ordenPresentacion, tiempoSegundos
            );
            logger.log(`${TAG} responder: OK correcta=${res.correcta} finalizada=${res.finalizadaPregunta}`);
            response.json(reply.ok(res));
        } catch (e) {
            // Errores de negocio esperables → mensaje legible (no fatal)
            if (["ALT_INVALIDA", "YA_RESPONDIDA", "SIN_INTENTO1", "YA_FINALIZADA", "YA_CORRECTA"].includes(e.code)) {
                logger.log(`${TAG} responder: rechazado (${e.code})`);
                return response.json(reply.error(e.message));
            }
            throw e;
        }
    } catch (e) {
        logger.log(`${TAG_ERR} responder: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/** POST /evaluacion/finalizar  body: { evaluacionId } (RF-39/40/44) */
async function finalizar(request, response) {
    const b = _leerArg(request);
    const evaluacionId = Number(b.evaluacionId);
    logger.log(`${TAG} finalizar: eval=${evaluacionId}`);
    try {
        if (!Number.isInteger(evaluacionId) || evaluacionId <= 0)
            return response.json(reply.error("evaluacionId requerido"));

        const ev = await evalRepo.obtenerEvaluacion(evaluacionId);
        if (!ev) return response.json(reply.error("Evaluación no encontrada"));

        // Idempotente: si ya está finalizada, recalcular igual no hace daño,
        // pero evitamos re-finalizar una ABANDONADA.
        if (ev.estado === "ABANDONADA")
            return response.json(reply.error("La evaluación fue abandonada"));

        const resumen = await evalRepo.finalizarEvaluacion(evaluacionId, ev.aplicacion_id);
        logger.log(`${TAG} finalizar: OK ${JSON.stringify(resumen)}`);
        response.json(reply.ok({ evaluacion_id: evaluacionId, modalidad: ev.modalidad, ...resumen }));
    } catch (e) {
        logger.log(`${TAG_ERR} finalizar: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/** Etiqueta legible para el resultado de una pregunta. */
function _labelResultado(r) {
    switch (r) {
        case "CORRECTA_INT1": return "Correcta (1er intento)";
        case "CORRECTA_INT2": return "Correcta (2do intento)";
        case "INCORRECTA":    return "Incorrecta";
        default:              return "Sin responder";
    }
}

function _escapeHtml(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** Construye el cuerpo HTML + texto del informe de resultados (RF-41). */
function _construirInforme(info, detalle) {
    const correctas = (info.aciertos_primer || 0) + (info.aciertos_segundo || 0);
    const pct = info.porcentaje_global != null ? info.porcentaje_global : 0;

    const filasHtml = (detalle || [])
        .map((d) => {
            const ok = d.resultado === "CORRECTA_INT1" || d.resultado === "CORRECTA_INT2";
            const color = ok ? "#2e7d32" : (d.resultado === "INCORRECTA" ? "#c62828" : "#757575");
            return `<tr>
                <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${d.orden_presentacion}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #eee;">${_escapeHtml(d.enunciado)}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #eee;color:${color};white-space:nowrap;">${_labelResultado(d.resultado)}</td>
            </tr>`;
        })
        .join("");

    const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#222;">
        <h2 style="color:#1565c0;margin-bottom:4px;">Auris — Informe de resultados</h2>
        <p style="margin:0 0 16px;color:#555;">
            ${_escapeHtml(info.curso_nombre)} (${_escapeHtml(info.curso_codigo)}) · <strong>${_escapeHtml(info.test_nombre)}</strong>
        </p>

        <div style="background:#f5f7fb;border-radius:10px;padding:16px;margin-bottom:16px;text-align:center;">
            <div style="font-size:40px;font-weight:bold;color:#1565c0;">${pct}%</div>
            <div style="color:#666;">de aciertos (${correctas} de ${info.total_preguntas})</div>
        </div>

        <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
            <tr><td style="padding:4px 0;">✅ Correctas (1er intento)</td><td style="text-align:right;"><strong>${info.aciertos_primer || 0}</strong></td></tr>
            <tr><td style="padding:4px 0;">🔁 Correctas (2do intento)</td><td style="text-align:right;"><strong>${info.aciertos_segundo || 0}</strong></td></tr>
            <tr><td style="padding:4px 0;">❌ Incorrectas</td><td style="text-align:right;"><strong>${info.incorrectas || 0}</strong></td></tr>
            <tr><td style="padding:4px 0;border-top:1px solid #ddd;">Total de preguntas</td><td style="text-align:right;border-top:1px solid #ddd;"><strong>${info.total_preguntas}</strong></td></tr>
        </table>

        ${filasHtml ? `
        <h3 style="color:#333;font-size:16px;">Detalle por pregunta</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead>
                <tr style="background:#eef2f8;">
                    <th style="padding:6px 8px;text-align:center;">#</th>
                    <th style="padding:6px 8px;text-align:left;">Pregunta</th>
                    <th style="padding:6px 8px;text-align:left;">Resultado</th>
                </tr>
            </thead>
            <tbody>${filasHtml}</tbody>
        </table>` : ""}

        <p style="color:#999;font-size:12px;margin-top:24px;">
            Este es un informe automático de tu evaluación en Auris. No respondas a este correo.
        </p>
    </div>`;

    const lineasTxt = (detalle || [])
        .map((d) => `  ${d.orden_presentacion}. [${_labelResultado(d.resultado)}] ${d.enunciado}`)
        .join("\n");

    const text =
        `Auris — Informe de resultados\n` +
        `${info.curso_nombre} (${info.curso_codigo}) · ${info.test_nombre}\n\n` +
        `Porcentaje de aciertos: ${pct}% (${correctas} de ${info.total_preguntas})\n` +
        `Correctas (1er intento): ${info.aciertos_primer || 0}\n` +
        `Correctas (2do intento): ${info.aciertos_segundo || 0}\n` +
        `Incorrectas: ${info.incorrectas || 0}\n` +
        `Total de preguntas: ${info.total_preguntas}\n\n` +
        (lineasTxt ? `Detalle por pregunta:\n${lineasTxt}\n\n` : "") +
        `— Equipo Auris`;

    return { html, text };
}

/**
 * POST /evaluacion/enviarInforme  body: { evaluacionId }
 * Envía por correo el informe de una evaluación FINALIZADA e IDENTIFICADA
 * (RF-41/42). Marca informe_enviado_en al despachar.
 */
async function enviarInforme(request, response) {
    const b = _leerArg(request);
    const evaluacionId = Number(b.evaluacionId);
    logger.log(`${TAG} enviarInforme: eval=${evaluacionId}`);
    try {
        if (!Number.isInteger(evaluacionId) || evaluacionId <= 0)
            return response.json(reply.error("evaluacionId requerido"));

        const info = await evalRepo.obtenerInforme(evaluacionId);
        if (!info) return response.json(reply.error("Evaluación no encontrada"));
        if (info.estado !== "FINALIZADA")
            return response.json(reply.error("La evaluación aún no está finalizada"));
        if (info.modalidad !== "IDENTIFICADA" || !info.correo_estudiante)
            return response.json(
                reply.error("Esta evaluación es anónima: no hay un correo al cual enviar el informe")
            );

        const detalle = await evalRepo.obtenerDetallePorPregunta(evaluacionId);
        const { html, text } = _construirInforme(info, detalle);

        const r = await mailer.send({
            to: info.correo_estudiante,
            subject: `Auris — Tu informe de resultados: ${info.test_nombre}`,
            html,
            text,
        });

        await evalRepo.marcarInformeEnviado(evaluacionId);

        logger.log(`${TAG} enviarInforme: OK correo=${info.correo_estudiante} modo=${r && r.mode}`);
        response.json(
            reply.ok({
                enviado: true,
                correo: info.correo_estudiante,
                modo: r && r.mode ? r.mode : "smtp",
            })
        );
    } catch (e) {
        logger.log(`${TAG_ERR} enviarInforme: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/**
 * POST /evaluacion/informeCompleto   body: { evaluacionId }
 * Devuelve el detalle completo para descargar como PDF (pedido cliente
 * 2026-05-26). PÚBLICO: aplica tanto a evaluaciones anónimas como
 * identificadas, no requiere JWT (igual que el resto del flujo estudiante).
 *
 * Devuelve: cabecera + lista de preguntas con todas las alternativas,
 * cuál marcó el estudiante en cada intento, cuál era la correcta,
 * explicación clínica y tiempo dedicado.
 */
async function informeCompleto(request, response) {
    const b = _leerArg(request);
    const evaluacionId = Number(b.evaluacionId);
    logger.log(`${TAG} informeCompleto: eval=${evaluacionId}`);
    try {
        if (!Number.isInteger(evaluacionId) || evaluacionId <= 0)
            return response.json(reply.error("evaluacionId requerido"));

        const info = await evalRepo.obtenerInforme(evaluacionId);
        if (!info) return response.json(reply.error("Evaluación no encontrada"));
        if (info.estado !== "FINALIZADA")
            return response.json(reply.error("La evaluación aún no está finalizada"));

        const preguntas = await evalRepo.obtenerInformeCompletoPorPregunta(evaluacionId);

        response.json(reply.ok({
            cabecera: {
                evaluacion_id: info.evaluacion_id,
                modalidad: info.modalidad,
                correo_estudiante: info.correo_estudiante, // null si anónima
                test_nombre: info.test_nombre,
                curso_nombre: info.curso_nombre,
                curso_codigo: info.curso_codigo,
                total_preguntas: info.total_preguntas,
                aciertos_primer: info.aciertos_primer,
                aciertos_segundo: info.aciertos_segundo,
                incorrectas: info.incorrectas,
                porcentaje_global: info.porcentaje_global,
                finalizada_en: info.finalizada_en,
            },
            preguntas: preguntas,
        }));
    } catch (e) {
        logger.log(`${TAG_ERR} informeCompleto: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

module.exports = {
    aplicacionesActivas,
    iniciar,
    responder,
    finalizar,
    enviarInforme,
    informeCompleto,
};
