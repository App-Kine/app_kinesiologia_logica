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
// Bloque P3.R9: utilidades compartidas
var { leerArg, RE_CORREO } = require("../../base/utils/argReader");
var { maskEmail } = require("../../base/utils/seguridad");

const TAG = "\x1b[36m[evaluacion]\x1b[0m";
const TAG_ERR = "\x1b[31m[evaluacion]\x1b[0m";

// UUID v4 (UNIQUEIDENTIFIER). El informe se pide por este identificador
// público y no adivinable, nunca por el evaluacion_id secuencial (evita que
// un tercero enumere IDs y extraiga correos/resultados de otros estudiantes).
const RE_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function _leerArg(request) { return leerArg(request, { tag: TAG_ERR }); }

/**
 * Resuelve el evaluacion_id interno a partir del UUID público recibido del
 * cliente. Devuelve { ok, evaluacionId, errorResponse }. Si el UUID falta, es
 * inválido o no existe, deja listo el response de error genérico.
 */
async function _resolverEvaluacionPorUuid(b, response) {
    const evaluacionUuid = b.evaluacionUuid ? String(b.evaluacionUuid).trim() : "";
    if (!RE_UUID.test(evaluacionUuid)) {
        return { ok: false, errorResponse: () => response.json(reply.error("evaluacionUuid requerido")) };
    }
    const evaluacionId = await evalRepo.resolverIdPorUuid(evaluacionUuid);
    if (!Number.isInteger(evaluacionId) || evaluacionId <= 0) {
        return { ok: false, errorResponse: () => response.json(reply.error("Evaluación no encontrada")) };
    }
    return { ok: true, evaluacionId: evaluacionId };
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
 *
 * CAMBIO (auditoría 2026-05-28): ya NO crea fila en auris.evaluacion.
 * Solo valida y devuelve las preguntas del test. La evaluación se persiste
 * únicamente cuando el estudiante envía el test completo (POST /enviar).
 *
 * Política: "como si no pasara nada" — si el estudiante abandona antes de
 * enviar, no queda rastro en la BD.
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

        const preguntas = await evalRepo.cargarPreguntas(
            apl.test_id,
            apl.orden_aleatorio === true || apl.orden_aleatorio === 1
        );

        if (preguntas.length === 0) {
            return response.json(reply.error("El test no tiene preguntas activas"));
        }

        logger.log(`${TAG} iniciar: OK (sin persistir) aplicacion=${aplicacionId} preguntas=${preguntas.length}`);
        response.json(
            reply.ok({
                aplicacion_id: aplicacionId,
                test_nombre: apl.test_nombre,
                modalidad: modalidad,
                correo: modalidad === "IDENTIFICADA" ? correo : null,
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
 * POST /evaluacion/corregir
 * body: { aplicacionId, preguntaId, alternativaId, intento }
 *
 * NUEVO (auditoría 2026-05-28). Corrige una respuesta SIN persistir nada.
 * Reemplaza al antiguo /responder, que sí escribía a BD por cada intento.
 *
 * Devuelve la corrección + (si la pregunta queda finalizada) la alternativa
 * correcta y la explicación clínica.
 */
async function corregir(request, response) {
    const b = _leerArg(request);
    const aplicacionId = Number(b.aplicacionId);
    const preguntaId = Number(b.preguntaId);
    const alternativaId = Number(b.alternativaId);
    const intento = Number(b.intento);
    logger.log(`${TAG} corregir: apl=${aplicacionId} preg=${preguntaId} intento=${intento}`);
    try {
        if (!Number.isInteger(aplicacionId) || aplicacionId <= 0)
            return response.json(reply.error("aplicacionId requerido"));
        if (!Number.isInteger(preguntaId) || preguntaId <= 0)
            return response.json(reply.error("preguntaId requerido"));
        if (!Number.isInteger(alternativaId) || alternativaId <= 0)
            return response.json(reply.error("alternativaId requerido"));
        if (intento !== 1 && intento !== 2)
            return response.json(reply.error("intento debe ser 1 o 2"));

        // Verificamos que la aplicación esté activa (RF-04 / RF-92)
        const apl = await evalRepo.obtenerAplicacionActiva(aplicacionId);
        if (!apl) {
            return response.json(reply.error("La aplicación no está disponible"));
        }

        try {
            const res = await evalRepo.corregirIntento(preguntaId, alternativaId, intento);
            logger.log(`${TAG} corregir: OK correcta=${res.correcta} reveal=${res.finalizadaPregunta}`);
            response.json(reply.ok(res));
        } catch (e) {
            if (e.code === "ALT_INVALIDA") {
                logger.log(`${TAG} corregir: rechazado (${e.code})`);
                return response.json(reply.error(e.message));
            }
            throw e;
        }
    } catch (e) {
        logger.log(`${TAG_ERR} corregir: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/**
 * POST /evaluacion/enviar
 * body: { aplicacionId, modalidad, correo?, respuestas: [...] }
 *
 * NUEVO (auditoría 2026-05-28). Crea la evaluación + todas las respuestas
 * en UNA transacción atómica. Si algo falla, ROLLBACK completo.
 *
 * Si el cliente nunca llega a llamar a este endpoint (cierra browser,
 * pierde conexión, abandona) NADA queda en la BD.
 */
async function enviar(request, response) {
    const b = _leerArg(request);
    const aplicacionId = Number(b.aplicacionId);
    const modalidad = (b.modalidad || "").toUpperCase();
    const correo = b.correo ? String(b.correo).trim() : null;
    const respuestas = Array.isArray(b.respuestas) ? b.respuestas : [];
    logger.log(`${TAG} enviar: apl=${aplicacionId} modalidad=${modalidad} respuestas=${respuestas.length}`);
    try {
        if (!Number.isInteger(aplicacionId) || aplicacionId <= 0)
            return response.json(reply.error("aplicacionId requerido"));
        if (modalidad !== "ANONIMA" && modalidad !== "IDENTIFICADA")
            return response.json(reply.error("modalidad debe ser ANONIMA o IDENTIFICADA"));
        if (modalidad === "IDENTIFICADA") {
            if (!correo) return response.json(reply.error("correo requerido en modalidad IDENTIFICADA"));
            if (!RE_CORREO.test(correo)) return response.json(reply.error("Formato de correo inválido"));
        }
        if (respuestas.length === 0)
            return response.json(reply.error("Debes responder al menos una pregunta"));

        // Normalizamos las respuestas que vienen del cliente
        const normalizadas = respuestas.map((r) => ({
            preguntaId: Number(r.preguntaId),
            ordenPresentacion: Number(r.ordenPresentacion) || 1,
            alternativaIntento1Id: Number(r.alternativaIntento1Id),
            alternativaIntento2Id: r.alternativaIntento2Id ? Number(r.alternativaIntento2Id) : null,
            tiempoSegundos: r.tiempoSegundos != null ? Number(r.tiempoSegundos) : null,
        }));

        // Validación simple de cada respuesta
        for (let i = 0; i < normalizadas.length; i++) {
            const r = normalizadas[i];
            if (!Number.isInteger(r.preguntaId) || r.preguntaId <= 0)
                return response.json(reply.error(`respuesta #${i+1}: preguntaId inválido`));
            if (!Number.isInteger(r.alternativaIntento1Id) || r.alternativaIntento1Id <= 0)
                return response.json(reply.error(`respuesta #${i+1}: alternativaIntento1Id inválido`));
            if (r.alternativaIntento2Id != null &&
                (!Number.isInteger(r.alternativaIntento2Id) || r.alternativaIntento2Id <= 0))
                return response.json(reply.error(`respuesta #${i+1}: alternativaIntento2Id inválido`));
        }

        try {
            const resumen = await evalRepo.enviarEvaluacionCompleta({
                aplicacionId,
                modalidad,
                correo: modalidad === "IDENTIFICADA" ? correo : null,
                respuestas: normalizadas,
            });
            logger.log(`${TAG} enviar: OK evaluacion_id=${resumen.evaluacion_id} pct=${resumen.porcentaje_global}%`);
            response.json(reply.ok({ modalidad, ...resumen }));
        } catch (e) {
            if (["APL_INACTIVA", "SIN_RESPUESTAS", "ALT_INVALIDA"].includes(e.code)) {
                logger.log(`${TAG} enviar: rechazado (${e.code})`);
                return response.json(reply.error(e.message));
            }
            throw e;
        }
    } catch (e) {
        logger.log(`${TAG_ERR} enviar: ${e.message}`, e);
        response.json(reply.fatal(e));
    }
}

/**
 * POST /evaluacion/responder
 *
 * @deprecated 2026-05-28. Reemplazado por /corregir (corrección sin
 * persistir) + /enviar (persistencia atómica al final). Devuelve error
 * inmediato para que el cliente migre al nuevo flujo.
 */
async function responder(request, response) {
    logger.log(`${TAG_ERR} responder: endpoint deprecado, usa /corregir y /enviar`);
    return response.json(reply.error(
        "Endpoint deprecado. Migrar a /evaluacion/corregir + /evaluacion/enviar."
    ));
}

/* ===== Implementación antigua (preservada por si necesitas migración rollback) =====
async function _responder_LEGACY(request, response) {
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
===== fin LEGACY ===== */

/**
 * POST /evaluacion/finalizar
 *
 * @deprecated 2026-05-28. Reemplazado por /enviar que crea evaluación +
 * respuestas + totales en una sola transacción. Devuelve error inmediato.
 */
async function finalizar(request, response) {
    logger.log(`${TAG_ERR} finalizar: endpoint deprecado, usa /enviar`);
    return response.json(reply.error(
        "Endpoint deprecado. Migrar a /evaluacion/enviar."
    ));
}

/* ===== Implementación antigua preservada =====
async function _finalizar_LEGACY(request, response) {
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
===== fin LEGACY ===== */

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
 * POST /evaluacion/enviarInforme  body: { evaluacionUuid }
 * Envía por correo el informe de una evaluación FINALIZADA e IDENTIFICADA
 * (RF-41/42). Marca informe_enviado_en al despachar. Se identifica por UUID
 * público (no por el id secuencial, que sería enumerable sin login).
 */
async function enviarInforme(request, response) {
    const b = _leerArg(request);
    logger.log(`${TAG} enviarInforme: uuid=${b.evaluacionUuid}`);
    try {
        const res = await _resolverEvaluacionPorUuid(b, response);
        if (!res.ok) return res.errorResponse();
        const evaluacionId = res.evaluacionId;

        const info = await evalRepo.obtenerInforme(evaluacionId);
        if (!info) return response.json(reply.error("Evaluación no encontrada"));
        if (info.estado !== "FINALIZADA")
            return response.json(reply.error("La evaluación aún no está finalizada"));
        if (info.modalidad !== "IDENTIFICADA" || !info.correo_estudiante)
            return response.json(
                reply.error("Esta evaluación es anónima: no hay un correo al cual enviar el informe")
            );

        // Idempotencia (RF-41/42): si el informe ya se despachó antes, NO lo
        // reenviamos. `obtenerInforme` ya trae `informe_enviado_en`; si tiene
        // valor respondemos OK marcando que ya estaba enviado, evitando correos
        // duplicados ante reintentos del cliente.
        if (info.informe_enviado_en) {
            logger.log(`${TAG} enviarInforme: ya enviado previamente, no se reenvía correo=${maskEmail(info.correo_estudiante)}`);
            return response.json(
                reply.ok({
                    enviado: true,
                    yaEnviado: true,
                    correo: info.correo_estudiante,
                })
            );
        }

        const detalle = await evalRepo.obtenerDetallePorPregunta(evaluacionId);
        const { html, text } = _construirInforme(info, detalle);

        // Adjuntar el PDF que generó la app (solo pasa en memoria; no se guarda).
        // Validamos que sea base64 plausible y acotamos el tamaño (~8MB de
        // base64). Si no cumple, enviamos el correo SIN adjunto y logueamos, en
        // vez de tirar un error fatal y perder el informe.
        const adjuntos = [];
        if (b.pdfBase64 && typeof b.pdfBase64 === "string") {
            const pdfLimpio = b.pdfBase64.replace(/[\r\n]/g, "");
            const RE_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
            const MAX_PDF_BASE64 = 8 * 1024 * 1024; // ~8MB de base64
            if (!RE_BASE64.test(pdfLimpio)) {
                logger.log(`${TAG_ERR} enviarInforme: pdfBase64 no parece base64 válido, se omite el adjunto`);
            } else if (pdfLimpio.length > MAX_PDF_BASE64) {
                logger.log(`${TAG_ERR} enviarInforme: pdfBase64 demasiado grande (${pdfLimpio.length} bytes), se omite el adjunto`);
            } else {
                const nombrePdf =
                    "Auris-informe-" +
                    String(info.test_nombre || "resultado")
                        .replace(/[^a-zA-Z0-9-_]+/g, "_")
                        .slice(0, 60) +
                    ".pdf";
                adjuntos.push({
                    filename: nombrePdf,
                    content: pdfLimpio,
                    encoding: "base64",
                    contentType: "application/pdf",
                });
            }
        }

        const r = await mailer.send({
            to: info.correo_estudiante,
            subject: `Auris — Tu informe de resultados: ${info.test_nombre}`,
            html,
            text,
            attachments: adjuntos,
        });

        // El correo YA salió. Si el marcado en BD falla (p.ej. timeout SQL), NO
        // debemos responder fatal: el cliente reintentaría y se enviaría un
        // correo duplicado. Capturamos ese error puntual, lo logueamos y
        // respondemos OK igual. Solo un fallo de `mailer.send` (arriba) propaga
        // error real.
        try {
            await evalRepo.marcarInformeEnviado(evaluacionId);
        } catch (eMarcar) {
            logger.log(
                `${TAG_ERR} enviarInforme: correo enviado OK pero falló marcarInformeEnviado: ${eMarcar.message}`,
                eMarcar
            );
        }

        logger.log(`${TAG} enviarInforme: OK correo=${maskEmail(info.correo_estudiante)} modo=${r && r.mode}`);
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
 * POST /evaluacion/informeCompleto   body: { evaluacionUuid }
 * Devuelve el detalle completo para descargar como PDF (pedido cliente
 * 2026-05-26). PÚBLICO: aplica tanto a evaluaciones anónimas como
 * identificadas, no requiere JWT (igual que el resto del flujo estudiante).
 *
 * Seguridad: se identifica por el UUID público (UNIQUEIDENTIFIER, no
 * adivinable). NO acepta el evaluacion_id secuencial — de lo contrario
 * cualquiera podría enumerar IDs y extraer correos + resultados de otros
 * estudiantes en este endpoint sin autenticación.
 *
 * Devuelve: cabecera + lista de preguntas con todas las alternativas,
 * cuál marcó el estudiante en cada intento, cuál era la correcta,
 * explicación clínica y tiempo dedicado.
 */
async function informeCompleto(request, response) {
    const b = _leerArg(request);
    logger.log(`${TAG} informeCompleto: uuid=${b.evaluacionUuid}`);
    try {
        const res = await _resolverEvaluacionPorUuid(b, response);
        if (!res.ok) return res.errorResponse();
        const evaluacionId = res.evaluacionId;

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
    corregir,      // NUEVO: corrección sin persistir
    enviar,        // NUEVO: persistencia atómica al final
    responder,     // DEPRECADO: devuelve error
    finalizar,    // DEPRECADO: devuelve error
    enviarInforme,
    informeCompleto,
};
