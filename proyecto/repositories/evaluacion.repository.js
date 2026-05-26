"use strict";

/**
 * Repositorio del flujo de evaluación del ESTUDIANTE (público, sin login).
 * Cubre RF-04/RF-06/RF-11/RF-14/RF-15/RF-23/RF-26/RF-31..RF-44.
 *
 * Seguridad: la corrección se calcula SIEMPRE en el servidor. `cargarPreguntas`
 * NUNCA expone `es_correcta`. La alternativa correcta + explicación se revelan
 * sólo cuando la pregunta queda finalizada (acierto o 2 intentos) — RF-36/RF-38.
 */

var db = require("../../base/utils/db");

const TAG_ERR = "\x1b[31m[evaluacion.repo]\x1b[0m";

/**
 * Aplicaciones de test ACTIVAS y visibles de un curso (RF-04, RF-92).
 */
async function listarAplicacionesActivasPorCurso(cursoId) {
    const r = await db
        .request("auris")
        .input("curso_id", db.sql.BigInt, cursoId)
        .query(`
            SELECT  a.aplicacion_id,
                    a.aplicacion_uuid,
                    a.test_id,
                    t.nombre AS test_nombre,
                    t.descripcion AS test_descripcion,
                    (SELECT COUNT(*) FROM auris.test_pregunta tp
                       WHERE tp.test_id = t.test_id) AS cantidad_preguntas
            FROM    auris.aplicacion_test a
            JOIN    auris.test t ON t.test_id = a.test_id
            WHERE   a.curso_id = @curso_id
              AND   a.activo = 1
              AND   t.activo = 1
              AND   (a.visible_desde IS NULL OR a.visible_desde <= SYSUTCDATETIME())
              AND   (a.visible_hasta IS NULL OR a.visible_hasta >= SYSUTCDATETIME())
            ORDER BY a.created_at DESC;
        `);
    return r.recordset;
}

/**
 * Devuelve la aplicación si está activa/visible (con su test). Null si no.
 */
async function obtenerAplicacionActiva(aplicacionId) {
    const r = await db
        .request("auris")
        .input("aplicacion_id", db.sql.BigInt, aplicacionId)
        .query(`
            SELECT  a.aplicacion_id, a.test_id, a.activo,
                    t.nombre AS test_nombre, t.orden_aleatorio, t.activo AS test_activo
            FROM    auris.aplicacion_test a
            JOIN    auris.test t ON t.test_id = a.test_id
            WHERE   a.aplicacion_id = @aplicacion_id
              AND   a.activo = 1
              AND   t.activo = 1
              AND   (a.visible_desde IS NULL OR a.visible_desde <= SYSUTCDATETIME())
              AND   (a.visible_hasta IS NULL OR a.visible_hasta >= SYSUTCDATETIME());
        `);
    return r.recordset[0] || null;
}

/**
 * Crea una evaluación EN_CURSO. Respeta CK_eval_correo_consistente.
 * @returns {Promise<{evaluacion_id:number, evaluacion_uuid:string}>}
 */
async function iniciarEvaluacion(aplicacionId, modalidad, correo) {
    const r = await db
        .request("auris")
        .input("aplicacion_id", db.sql.BigInt, aplicacionId)
        .input("modalidad", db.sql.VarChar(15), modalidad)
        .input("correo", db.sql.NVarChar(254), correo || null)
        .query(`
            INSERT INTO auris.evaluacion
                (aplicacion_id, modalidad, correo_estudiante, estado)
            OUTPUT INSERTED.evaluacion_id, INSERTED.evaluacion_uuid
            VALUES (@aplicacion_id, @modalidad, @correo, 'EN_CURSO');
        `);
    return r.recordset[0];
}

/**
 * Carga las preguntas del test de una aplicación, con alternativas SIN
 * `es_correcta`, en orden secuencial o aleatorio (RF-15). Asigna
 * `orden_presentacion` (1..N) que el frontend devuelve al responder.
 */
async function cargarPreguntas(testId, ordenAleatorio) {
    const pool = db.getPool("auris");

    const ordenClause = ordenAleatorio ? "NEWID()" : "tp.orden";
    const rPreg = await pool
        .request()
        .input("test_id", db.sql.BigInt, testId)
        .query(`
            SELECT  tp.pregunta_id,
                    p.enunciado,
                    p.audio_grid_id,
                    p.imagen_grid_id
            FROM    auris.test_pregunta tp
            JOIN    auris.pregunta p ON p.pregunta_id = tp.pregunta_id
            WHERE   tp.test_id = @test_id
              AND   p.activo = 1
            ORDER BY ${ordenClause};
        `);

    const preguntas = rPreg.recordset;
    if (preguntas.length === 0) return [];

    // Alternativas de todas las preguntas (sin es_correcta), en una query.
    const ids = preguntas.map((p) => Number(p.pregunta_id));
    const reqAlt = pool.request();
    const placeholders = ids.map((_, i) => {
        reqAlt.input(`p${i}`, db.sql.BigInt, ids[i]);
        return `@p${i}`;
    });
    const rAlt = await reqAlt.query(`
        SELECT alternativa_id, pregunta_id, texto, orden
        FROM   auris.alternativa
        WHERE  pregunta_id IN (${placeholders.join(",")})
        ORDER BY pregunta_id, orden;
    `);

    const altsPorPregunta = {};
    for (const a of rAlt.recordset) {
        const k = String(a.pregunta_id);
        if (!altsPorPregunta[k]) altsPorPregunta[k] = [];
        altsPorPregunta[k].push({
            alternativa_id: a.alternativa_id,
            texto: a.texto,
            orden: a.orden,
        });
    }

    return preguntas.map((p, idx) => ({
        pregunta_id: p.pregunta_id,
        orden_presentacion: idx + 1,
        enunciado: p.enunciado,
        audio_grid_id: p.audio_grid_id,
        imagen_grid_id: p.imagen_grid_id,
        alternativas: altsPorPregunta[String(p.pregunta_id)] || [],
    }));
}

/** Estado de la evaluación (para validar EN_CURSO). Null si no existe. */
async function obtenerEvaluacion(evaluacionId) {
    const r = await db
        .request("auris")
        .input("evaluacion_id", db.sql.BigInt, evaluacionId)
        .query(`
            SELECT evaluacion_id, aplicacion_id, estado, modalidad, correo_estudiante
            FROM   auris.evaluacion
            WHERE  evaluacion_id = @evaluacion_id;
        `);
    return r.recordset[0] || null;
}

/**
 * Devuelve {es_correcta, explicacion, correcta_id} de la pregunta + valida que
 * la alternativa pertenezca a ella. Si la alternativa no pertenece → null.
 */
async function _datosCorreccion(preguntaId, alternativaId) {
    const r = await db
        .request("auris")
        .input("pregunta_id", db.sql.BigInt, preguntaId)
        .input("alternativa_id", db.sql.BigInt, alternativaId)
        .query(`
            SELECT
                p.explicacion_clinica,
                (SELECT alternativa_id FROM auris.alternativa
                   WHERE pregunta_id = @pregunta_id AND es_correcta = 1) AS correcta_id,
                (SELECT es_correcta FROM auris.alternativa
                   WHERE alternativa_id = @alternativa_id AND pregunta_id = @pregunta_id) AS es_correcta_sel
            FROM auris.pregunta p
            WHERE p.pregunta_id = @pregunta_id;
        `);
    const row = r.recordset[0];
    if (!row || row.es_correcta_sel === null || row.es_correcta_sel === undefined) {
        return null; // alternativa no pertenece a la pregunta
    }
    return {
        explicacion: row.explicacion_clinica,
        correctaId: Number(row.correcta_id),
        esCorrecta: row.es_correcta_sel === true || row.es_correcta_sel === 1,
    };
}

/** Fila de respuesta existente (o null) para (evaluacion, pregunta). */
async function _respuestaExistente(evaluacionId, preguntaId) {
    const r = await db
        .request("auris")
        .input("evaluacion_id", db.sql.BigInt, evaluacionId)
        .input("pregunta_id", db.sql.BigInt, preguntaId)
        .query(`
            SELECT respuesta_id, intentos_usados, correcta_intento1, resultado
            FROM   auris.respuesta_pregunta
            WHERE  evaluacion_id = @evaluacion_id AND pregunta_id = @pregunta_id;
        `);
    return r.recordset[0] || null;
}

/**
 * Registra un intento de respuesta. Toda la lógica de 2 intentos vive acá.
 * @returns objeto con el resultado del intento (ver evaluacion.service).
 */
async function registrarRespuesta(evaluacionId, preguntaId, alternativaId, intento, ordenPresentacion) {
    const corr = await _datosCorreccion(preguntaId, alternativaId);
    if (!corr) {
        const e = new Error("La alternativa no pertenece a la pregunta");
        e.code = "ALT_INVALIDA";
        throw e;
    }

    const previa = await _respuestaExistente(evaluacionId, preguntaId);

    if (intento === 1) {
        if (previa) {
            const e = new Error("La pregunta ya fue respondida (RF-26)");
            e.code = "YA_RESPONDIDA";
            throw e;
        }
        const resultado = corr.esCorrecta ? "CORRECTA_INT1" : null; // null = aún no finalizada
        await db
            .request("auris")
            .input("evaluacion_id", db.sql.BigInt, evaluacionId)
            .input("pregunta_id", db.sql.BigInt, preguntaId)
            .input("orden", db.sql.SmallInt, ordenPresentacion)
            .input("alt1", db.sql.BigInt, alternativaId)
            .input("correcta1", db.sql.Bit, corr.esCorrecta ? 1 : 0)
            .input("resultado", db.sql.VarChar(20), resultado)
            .query(`
                INSERT INTO auris.respuesta_pregunta
                    (evaluacion_id, pregunta_id, orden_presentacion,
                     alternativa_intento1_id, correcta_intento1,
                     intentos_usados, resultado)
                VALUES (@evaluacion_id, @pregunta_id, @orden,
                        @alt1, @correcta1, 1, @resultado);
            `);

        const finalizada = corr.esCorrecta;
        return {
            correcta: corr.esCorrecta,
            intento: 1,
            intentosUsados: 1,
            finalizadaPregunta: finalizada,
            puedeReintentar: !corr.esCorrecta,
            correctaAlternativaId: finalizada ? corr.correctaId : null,
            explicacion: finalizada ? corr.explicacion : null,
        };
    }

    // intento === 2
    if (!previa) {
        const e = new Error("No existe un primer intento para esta pregunta");
        e.code = "SIN_INTENTO1";
        throw e;
    }
    if (previa.intentos_usados >= 2 || previa.resultado !== null) {
        const e = new Error("La pregunta ya está finalizada (RF-26/RF-31)");
        e.code = "YA_FINALIZADA";
        throw e;
    }
    if (previa.correcta_intento1 === true || previa.correcta_intento1 === 1) {
        const e = new Error("El primer intento ya fue correcto");
        e.code = "YA_CORRECTA";
        throw e;
    }

    const resultado2 = corr.esCorrecta ? "CORRECTA_INT2" : "INCORRECTA";
    await db
        .request("auris")
        .input("evaluacion_id", db.sql.BigInt, evaluacionId)
        .input("pregunta_id", db.sql.BigInt, preguntaId)
        .input("alt2", db.sql.BigInt, alternativaId)
        .input("correcta2", db.sql.Bit, corr.esCorrecta ? 1 : 0)
        .input("resultado", db.sql.VarChar(20), resultado2)
        .query(`
            UPDATE auris.respuesta_pregunta
            SET    alternativa_intento2_id = @alt2,
                   correcta_intento2 = @correcta2,
                   intentos_usados = 2,
                   resultado = @resultado
            WHERE  evaluacion_id = @evaluacion_id AND pregunta_id = @pregunta_id;
        `);

    return {
        correcta: corr.esCorrecta,
        intento: 2,
        intentosUsados: 2,
        finalizadaPregunta: true,
        puedeReintentar: false,
        correctaAlternativaId: corr.correctaId, // RF-35: revela la correcta
        explicacion: corr.explicacion,          // RF-36
    };
}

/**
 * Calcula totales, marca FINALIZADA y devuelve el resumen (RF-39/40/44).
 */
async function finalizarEvaluacion(evaluacionId, aplicacionId) {
    const pool = db.getPool("auris");

    // total de preguntas del test de la aplicación
    const rTotal = await pool
        .request()
        .input("aplicacion_id", db.sql.BigInt, aplicacionId)
        .query(`
            SELECT COUNT(*) AS total
            FROM   auris.test_pregunta tp
            JOIN   auris.aplicacion_test a ON a.test_id = tp.test_id
            WHERE  a.aplicacion_id = @aplicacion_id;
        `);
    const totalPreguntas = rTotal.recordset[0].total;

    const rAgg = await pool
        .request()
        .input("evaluacion_id", db.sql.BigInt, evaluacionId)
        .query(`
            SELECT
                SUM(CASE WHEN resultado = 'CORRECTA_INT1' THEN 1 ELSE 0 END) AS aciertos_primer,
                SUM(CASE WHEN resultado = 'CORRECTA_INT2' THEN 1 ELSE 0 END) AS aciertos_segundo,
                SUM(CASE WHEN resultado = 'INCORRECTA'    THEN 1 ELSE 0 END) AS incorrectas
            FROM auris.respuesta_pregunta
            WHERE evaluacion_id = @evaluacion_id;
        `);
    const agg = rAgg.recordset[0];
    const aciertosPrimer = agg.aciertos_primer || 0;
    const aciertosSegundo = agg.aciertos_segundo || 0;
    const incorrectas = agg.incorrectas || 0;
    const porcentaje =
        totalPreguntas > 0
            ? Math.round(((aciertosPrimer + aciertosSegundo) / totalPreguntas) * 10000) / 100
            : 0;

    await pool
        .request()
        .input("evaluacion_id", db.sql.BigInt, evaluacionId)
        .input("total", db.sql.SmallInt, totalPreguntas)
        .input("ap", db.sql.SmallInt, aciertosPrimer)
        .input("as", db.sql.SmallInt, aciertosSegundo)
        .input("inc", db.sql.SmallInt, incorrectas)
        .input("pct", db.sql.Decimal(5, 2), porcentaje)
        .query(`
            UPDATE auris.evaluacion
            SET    estado = 'FINALIZADA',
                   finalizada_en = SYSUTCDATETIME(),
                   total_preguntas = @total,
                   aciertos_primer = @ap,
                   aciertos_segundo = @as,
                   incorrectas = @inc,
                   porcentaje_global = @pct
            WHERE  evaluacion_id = @evaluacion_id;
        `);

    return {
        total_preguntas: totalPreguntas,
        aciertos_primer: aciertosPrimer,
        aciertos_segundo: aciertosSegundo,
        incorrectas: incorrectas,
        porcentaje_global: porcentaje,
    };
}

/**
 * Datos completos de una evaluación finalizada para armar el informe por
 * correo (RF-41/42): totales + correo del estudiante + test/curso. Null si no.
 */
async function obtenerInforme(evaluacionId) {
    const r = await db
        .request("auris")
        .input("evaluacion_id", db.sql.BigInt, evaluacionId)
        .query(`
            SELECT  e.evaluacion_id,
                    e.modalidad,
                    e.correo_estudiante,
                    e.estado,
                    e.total_preguntas,
                    e.aciertos_primer,
                    e.aciertos_segundo,
                    e.incorrectas,
                    e.porcentaje_global,
                    e.finalizada_en,
                    e.informe_enviado_en,
                    t.nombre  AS test_nombre,
                    c.nombre  AS curso_nombre,
                    c.codigo  AS curso_codigo
            FROM    auris.evaluacion e
            JOIN    auris.aplicacion_test a ON a.aplicacion_id = e.aplicacion_id
            JOIN    auris.test  t ON t.test_id  = a.test_id
            JOIN    auris.curso c ON c.curso_id = a.curso_id
            WHERE   e.evaluacion_id = @evaluacion_id;
        `);
    return r.recordset[0] || null;
}

/**
 * Desglose pregunta a pregunta de una evaluación (para el cuerpo del informe).
 * Devuelve enunciado + resultado de cada pregunta respondida, en orden.
 */
async function obtenerDetallePorPregunta(evaluacionId) {
    const r = await db
        .request("auris")
        .input("evaluacion_id", db.sql.BigInt, evaluacionId)
        .query(`
            SELECT  rp.orden_presentacion,
                    p.enunciado,
                    rp.resultado,
                    rp.intentos_usados
            FROM    auris.respuesta_pregunta rp
            JOIN    auris.pregunta p ON p.pregunta_id = rp.pregunta_id
            WHERE   rp.evaluacion_id = @evaluacion_id
            ORDER BY rp.orden_presentacion;
        `);
    return r.recordset;
}

/** Marca el informe como enviado (RF-42). */
async function marcarInformeEnviado(evaluacionId) {
    await db
        .request("auris")
        .input("evaluacion_id", db.sql.BigInt, evaluacionId)
        .query(`
            UPDATE auris.evaluacion
            SET    informe_enviado_en = SYSUTCDATETIME()
            WHERE  evaluacion_id = @evaluacion_id;
        `);
}

module.exports = {
    listarAplicacionesActivasPorCurso,
    obtenerAplicacionActiva,
    iniciarEvaluacion,
    cargarPreguntas,
    obtenerEvaluacion,
    registrarRespuesta,
    finalizarEvaluacion,
    obtenerInforme,
    obtenerDetallePorPregunta,
    marcarInformeEnviado,
};
