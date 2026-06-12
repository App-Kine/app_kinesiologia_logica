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
                    a.orden,
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
            -- El orden definitivo (orden manual + nombre natural) lo aplica el
            -- frontend; aquí solo damos un orden estable por defecto.
            ORDER BY (CASE WHEN a.orden IS NULL THEN 1 ELSE 0 END), a.orden, a.created_at DESC;
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
                    p.imagen_grid_id,
                    p.video_grid_id
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
        video_grid_id: p.video_grid_id,
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
 *
 * `tiempoSegundos` (opcional, pedido cliente 2026-05-26): segundos que el
 * estudiante estuvo EN la pregunta antes de confirmar este intento. Solo
 * lo persistimos cuando este intento finaliza la pregunta (acierto en 1°,
 * acierto en 2°, o incorrecta tras 2 intentos), porque ese es el tiempo
 * "total dedicado a la pregunta" que tiene sentido para el informe/analítica.
 *
 * @returns objeto con el resultado del intento (ver evaluacion.service).
 */
async function registrarRespuesta(evaluacionId, preguntaId, alternativaId, intento, ordenPresentacion, tiempoSegundos) {
    const corr = await _datosCorreccion(preguntaId, alternativaId);
    if (!corr) {
        const e = new Error("La alternativa no pertenece a la pregunta");
        e.code = "ALT_INVALIDA";
        throw e;
    }

    const previa = await _respuestaExistente(evaluacionId, preguntaId);

    // Helper: solo guardamos tiempo cuando la pregunta queda finalizada.
    const tiempoFinal = (tiempoSegundos != null && tiempoSegundos >= 0)
        ? Math.round(Number(tiempoSegundos))
        : null;

    if (intento === 1) {
        if (previa) {
            const e = new Error("La pregunta ya fue respondida (RF-26)");
            e.code = "YA_RESPONDIDA";
            throw e;
        }
        const finalizada = corr.esCorrecta;
        const resultado = finalizada ? "CORRECTA_INT1" : null; // null = aún no finalizada
        const tiempoCol = finalizada ? tiempoFinal : null;
        await db
            .request("auris")
            .input("evaluacion_id", db.sql.BigInt, evaluacionId)
            .input("pregunta_id", db.sql.BigInt, preguntaId)
            .input("orden", db.sql.SmallInt, ordenPresentacion)
            .input("alt1", db.sql.BigInt, alternativaId)
            .input("correcta1", db.sql.Bit, corr.esCorrecta ? 1 : 0)
            .input("resultado", db.sql.VarChar(20), resultado)
            .input("tiempo", db.sql.Int, tiempoCol)
            .query(`
                INSERT INTO auris.respuesta_pregunta
                    (evaluacion_id, pregunta_id, orden_presentacion,
                     alternativa_intento1_id, correcta_intento1,
                     intentos_usados, resultado, tiempo_segundos)
                VALUES (@evaluacion_id, @pregunta_id, @orden,
                        @alt1, @correcta1, 1, @resultado, @tiempo);
            `);

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
        .input("tiempo", db.sql.Int, tiempoFinal)
        .query(`
            UPDATE auris.respuesta_pregunta
            SET    alternativa_intento2_id = @alt2,
                   correcta_intento2 = @correcta2,
                   intentos_usados = 2,
                   resultado = @resultado,
                   tiempo_segundos = @tiempo
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
 * Resuelve el evaluacion_id (BigInt interno) a partir del evaluacion_uuid
 * público (UNIQUEIDENTIFIER no adivinable). Devuelve el número o null.
 *
 * Seguridad (auditoría 2026-06-01): el flujo del estudiante es público (sin
 * login), así que el informe NO puede identificarse por el id secuencial
 * —sería enumerable y filtraría correos + resultados de otros alumnos—. El
 * cliente solo conoce el UUID que recibió al enviar su propia evaluación.
 */
async function resolverIdPorUuid(evaluacionUuid) {
    const r = await db
        .request("auris")
        .input("evaluacion_uuid", db.sql.UniqueIdentifier, evaluacionUuid)
        .query(`
            SELECT  evaluacion_id
            FROM    auris.evaluacion
            WHERE   evaluacion_uuid = @evaluacion_uuid;
        `);
    return r.recordset[0] ? Number(r.recordset[0].evaluacion_id) : null;
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
 * Desglose pregunta a pregunta de una evaluación (informe corto por correo).
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
                    rp.intentos_usados,
                    rp.tiempo_segundos
            FROM    auris.respuesta_pregunta rp
            JOIN    auris.pregunta p ON p.pregunta_id = rp.pregunta_id
            WHERE   rp.evaluacion_id = @evaluacion_id
            ORDER BY rp.orden_presentacion;
        `);
    return r.recordset;
}

/**
 * Informe COMPLETO para descarga PDF (pedido cliente 2026-05-26):
 * para cada pregunta devuelve enunciado, explicación, alternativas, qué
 * alternativa eligió en cada intento, cuál era la correcta, y el tiempo
 * que tardó. Funciona para anónimas e identificadas.
 */
async function obtenerInformeCompletoPorPregunta(evaluacionId) {
    const pool = db.getPool("auris");

    const rPreg = await pool
        .request()
        .input("evaluacion_id", db.sql.BigInt, evaluacionId)
        .query(`
            SELECT  rp.respuesta_id,
                    rp.pregunta_id,
                    rp.orden_presentacion,
                    rp.alternativa_intento1_id,
                    rp.alternativa_intento2_id,
                    rp.intentos_usados,
                    rp.resultado,
                    rp.tiempo_segundos,
                    p.enunciado,
                    p.explicacion_clinica
            FROM    auris.respuesta_pregunta rp
            JOIN    auris.pregunta p ON p.pregunta_id = rp.pregunta_id
            WHERE   rp.evaluacion_id = @evaluacion_id
            ORDER BY rp.orden_presentacion;
        `);
    const preguntas = rPreg.recordset;
    if (preguntas.length === 0) return [];

    // Cargamos las alternativas de todas las preguntas en una sola query
    const ids = preguntas.map((p) => Number(p.pregunta_id));
    const reqAlt = pool.request();
    const placeholders = ids.map((_, i) => {
        reqAlt.input(`p${i}`, db.sql.BigInt, ids[i]);
        return `@p${i}`;
    });
    const rAlt = await reqAlt.query(`
        SELECT alternativa_id, pregunta_id, texto, es_correcta, orden
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
            es_correcta: a.es_correcta === true || a.es_correcta === 1,
            orden: a.orden,
        });
    }

    return preguntas.map((p) => ({
        orden_presentacion: p.orden_presentacion,
        pregunta_id: p.pregunta_id,
        enunciado: p.enunciado,
        explicacion_clinica: p.explicacion_clinica,
        intentos_usados: p.intentos_usados,
        resultado: p.resultado,
        tiempo_segundos: p.tiempo_segundos,
        alternativa_intento1_id: p.alternativa_intento1_id,
        alternativa_intento2_id: p.alternativa_intento2_id,
        alternativas: altsPorPregunta[String(p.pregunta_id)] || [],
    }));
}

/* =============================================================================
   NUEVO FLUJO (auditoría 2026-05-28): "como si no pasara nada".
   Si el estudiante no finaliza, NADA se persiste en BD. El backend tiene dos
   endpoints nuevos:
     - corregirIntento → corrección pura, sin escribir.
     - enviarEvaluacionCompleta → crea evaluacion + respuestas + totales
       todo en UNA transacción atómica al final.
   ============================================================================= */

/**
 * Corrige una respuesta SIN persistir nada. Devuelve es_correcta + (si la
 * pregunta queda "finalizada") correcta_id + explicación.
 *
 * El intento lo informa el cliente:
 *   - intento=1 + correcta  → revela
 *   - intento=1 + incorrecta → solo informa que no acertó (no revela)
 *   - intento=2              → siempre revela
 *
 * Esto reemplaza al endpoint `responder` que persistía cada intento.
 */
async function corregirIntento(preguntaId, alternativaId, intento) {
    const corr = await _datosCorreccion(preguntaId, alternativaId);
    if (!corr) {
        const e = new Error("La alternativa no pertenece a la pregunta");
        e.code = "ALT_INVALIDA";
        throw e;
    }
    const reveal = corr.esCorrecta || intento === 2;
    return {
        correcta: corr.esCorrecta,
        intento: intento,
        finalizadaPregunta: corr.esCorrecta || intento === 2,
        puedeReintentar: !corr.esCorrecta && intento === 1,
        correctaAlternativaId: reveal ? corr.correctaId : null,
        explicacion: reveal ? corr.explicacion : null,
    };
}

/**
 * Versión BATCH de _datosCorreccion para varias preguntas a la vez (evita N+1).
 *
 * Trae en UNA sola query todas las alternativas (id, pregunta_id, es_correcta) de
 * las preguntas involucradas con `IN (...)` —mismo patrón que `cargarPreguntas`—
 * más la explicación clínica de cada pregunta. Con eso resuelve EN MEMORIA, para
 * cada par (pregunta, alternativa elegida), exactamente lo mismo que devolvía
 * `_datosCorreccion`:
 *   - null  → la alternativa NO pertenece a la pregunta (ALT_INVALIDA)
 *   - { esCorrecta, correctaId, explicacion } → corrección válida
 *
 * @param {number[]} preguntaIds  ids de pregunta únicos a cargar.
 * @returns {Promise<Map<string, {esCorrecta:boolean, correctaId:number, explicacion:any}>>}
 *          función resolver: dado (preguntaId, alternativaId) devuelve el objeto
 *          de corrección o null. Se expone como `.resolver(preguntaId, altId)`.
 */
async function _cargarCorreccionBatch(preguntaIds) {
    const pool = db.getPool("auris");
    const ids = [...new Set(preguntaIds.map((x) => Number(x)))];

    // Explicación clínica + alternativa correcta por pregunta.
    const reqPreg = pool.request();
    const phPreg = ids.map((_, i) => {
        reqPreg.input(`q${i}`, db.sql.BigInt, ids[i]);
        return `@q${i}`;
    });
    const rPreg = await reqPreg.query(`
        SELECT  p.pregunta_id,
                p.explicacion_clinica,
                (SELECT alternativa_id FROM auris.alternativa
                   WHERE pregunta_id = p.pregunta_id AND es_correcta = 1) AS correcta_id
        FROM    auris.pregunta p
        WHERE   p.pregunta_id IN (${phPreg.join(",")});
    `);

    const infoPregunta = {}; // pregunta_id → { explicacion, correctaId }
    for (const row of rPreg.recordset) {
        infoPregunta[String(row.pregunta_id)] = {
            explicacion: row.explicacion_clinica,
            correctaId: row.correcta_id != null ? Number(row.correcta_id) : null,
        };
    }

    // Todas las alternativas de esas preguntas (para validar pertenencia + es_correcta).
    const reqAlt = pool.request();
    const phAlt = ids.map((_, i) => {
        reqAlt.input(`a${i}`, db.sql.BigInt, ids[i]);
        return `@a${i}`;
    });
    const rAlt = await reqAlt.query(`
        SELECT alternativa_id, pregunta_id, es_correcta
        FROM   auris.alternativa
        WHERE  pregunta_id IN (${phAlt.join(",")});
    `);

    // Mapa (pregunta_id + "|" + alternativa_id) → es_correcta booleano.
    const altIndex = {};
    for (const a of rAlt.recordset) {
        const k = `${a.pregunta_id}|${a.alternativa_id}`;
        altIndex[k] = a.es_correcta === true || a.es_correcta === 1;
    }

    return {
        /**
         * Réplica exacta de _datosCorreccion(preguntaId, alternativaId) pero en
         * memoria. Devuelve null si la alternativa no pertenece a la pregunta.
         */
        resolver(preguntaId, alternativaId) {
            const k = `${Number(preguntaId)}|${Number(alternativaId)}`;
            if (!(k in altIndex)) {
                return null; // alternativa no pertenece a la pregunta
            }
            const info = infoPregunta[String(Number(preguntaId))] || {
                explicacion: null,
                correctaId: null,
            };
            return {
                explicacion: info.explicacion,
                correctaId: info.correctaId,
                esCorrecta: altIndex[k],
            };
        },
    };
}

/**
 * Crea evaluación + respuestas + finaliza, TODO en una sola transacción.
 *
 * Si cualquier paso falla, ROLLBACK completo: la BD queda igual que antes.
 * Esto implementa la política "como si no pasara nada" si el estudiante
 * abandona: nunca se llama a esta función hasta que envía el test completo.
 *
 * La corrección se recalcula server-side (no se confía en lo que mande el
 * cliente), preservando RF-66 y la integridad de los resultados.
 *
 * @param {object} payload
 * @param {number} payload.aplicacionId
 * @param {string} payload.modalidad      "ANONIMA" | "IDENTIFICADA"
 * @param {string|null} payload.correo    requerido si IDENTIFICADA
 * @param {Array<{
 *     preguntaId:number,
 *     ordenPresentacion:number,
 *     alternativaIntento1Id:number,
 *     alternativaIntento2Id:number|null,
 *     tiempoSegundos:number|null
 * }>} payload.respuestas
 *
 * @returns resumen { evaluacion_id, evaluacion_uuid, total_preguntas,
 *                    aciertos_primer, aciertos_segundo, incorrectas,
 *                    porcentaje_global }
 */
async function enviarEvaluacionCompleta(payload) {
    const { aplicacionId, modalidad, correo, respuestas } = payload;
    const pool = db.getPool("auris");

    // Pre-validaciones (fuera de la transacción para fallar rápido sin escribir):
    // 1) Aplicación activa
    const apl = await obtenerAplicacionActiva(aplicacionId);
    if (!apl) {
        const e = new Error("La aplicación no está disponible");
        e.code = "APL_INACTIVA"; throw e;
    }

    // 2) Total de preguntas activas del test (para validar cobertura)
    const rTotal = await pool
        .request()
        .input("test_id", db.sql.BigInt, apl.test_id)
        .query(`
            SELECT COUNT(*) AS total
            FROM   auris.test_pregunta tp
            JOIN   auris.pregunta p ON p.pregunta_id = tp.pregunta_id
            WHERE  tp.test_id = @test_id AND p.activo = 1;
        `);
    const totalPreguntas = rTotal.recordset[0].total;

    if (!Array.isArray(respuestas) || respuestas.length === 0) {
        const e = new Error("Debes responder al menos una pregunta");
        e.code = "SIN_RESPUESTAS"; throw e;
    }

    // 3) Resolvemos la corrección de cada respuesta. Antes esto era un N+1:
    //    una query (con 2 subqueries) por alternativa de cada intento → hasta 2N
    //    queries. Ahora cargamos en BATCH todas las alternativas + explicaciones
    //    de las preguntas involucradas en 2 queries fijas (mismo patrón IN(...) de
    //    `cargarPreguntas`) y resolvemos la corrección en memoria. La lógica de
    //    corrección (correcta/incorrecta/ALT_INVALIDA) es idéntica a antes.
    //    (se hace antes de la transacción para no abrir locks innecesariamente)
    const correctoPorAlt = {};   // alternativa_id → { esCorrecta, correctaId, explicacion }
    const correccion = await _cargarCorreccionBatch(respuestas.map((r) => r.preguntaId));
    for (const r of respuestas) {
        const c1 = correccion.resolver(r.preguntaId, r.alternativaIntento1Id);
        if (!c1) {
            const e = new Error(`Alternativa de intento 1 inválida para pregunta ${r.preguntaId}`);
            e.code = "ALT_INVALIDA"; throw e;
        }
        correctoPorAlt[`${r.preguntaId}_1`] = c1;
        if (r.alternativaIntento2Id) {
            const c2 = correccion.resolver(r.preguntaId, r.alternativaIntento2Id);
            if (!c2) {
                const e = new Error(`Alternativa de intento 2 inválida para pregunta ${r.preguntaId}`);
                e.code = "ALT_INVALIDA"; throw e;
            }
            correctoPorAlt[`${r.preguntaId}_2`] = c2;
        }
    }

    // === Transacción atómica ===
    const tx = new db.sql.Transaction(pool);
    await tx.begin();
    try {
        // 1. Crear evaluación directamente como FINALIZADA
        const reqEv = new db.sql.Request(tx);
        const rEv = await reqEv
            .input("aplicacion_id", db.sql.BigInt, aplicacionId)
            .input("modalidad", db.sql.VarChar(15), modalidad)
            .input("correo", db.sql.NVarChar(254), correo || null)
            .query(`
                INSERT INTO auris.evaluacion
                    (aplicacion_id, modalidad, correo_estudiante, estado, finalizada_en)
                OUTPUT INSERTED.evaluacion_id, INSERTED.evaluacion_uuid
                VALUES (@aplicacion_id, @modalidad, @correo, 'FINALIZADA', SYSUTCDATETIME());
            `);
        const evaluacionId = rEv.recordset[0].evaluacion_id;
        const evaluacionUuid = rEv.recordset[0].evaluacion_uuid;

        // 2. Insertar todas las respuestas + calcular acumuladores
        let aciertosPrimer = 0, aciertosSegundo = 0, incorrectas = 0;

        for (const r of respuestas) {
            const c1 = correctoPorAlt[`${r.preguntaId}_1`];
            const c2 = r.alternativaIntento2Id ? correctoPorAlt[`${r.preguntaId}_2`] : null;

            let intentosUsados, resultado, alt2Id, correcta2;
            if (c1.esCorrecta) {
                intentosUsados = 1;
                resultado = "CORRECTA_INT1";
                alt2Id = null;
                correcta2 = null;
                aciertosPrimer++;
            } else if (c2) {
                intentosUsados = 2;
                resultado = c2.esCorrecta ? "CORRECTA_INT2" : "INCORRECTA";
                alt2Id = r.alternativaIntento2Id;
                correcta2 = c2.esCorrecta ? 1 : 0;
                if (c2.esCorrecta) aciertosSegundo++;
                else incorrectas++;
            } else {
                // intento 1 falló y no hay intento 2: incorrecta sin reintento
                intentosUsados = 1;
                resultado = "INCORRECTA";
                alt2Id = null;
                correcta2 = null;
                incorrectas++;
            }

            const tiempoSeg = (r.tiempoSegundos != null && Number.isFinite(Number(r.tiempoSegundos)))
                ? Math.max(0, Math.round(Number(r.tiempoSegundos)))
                : null;

            await new db.sql.Request(tx)
                .input("evaluacion_id", db.sql.BigInt, evaluacionId)
                .input("pregunta_id", db.sql.BigInt, r.preguntaId)
                .input("orden", db.sql.SmallInt, r.ordenPresentacion)
                .input("alt1", db.sql.BigInt, r.alternativaIntento1Id)
                .input("correcta1", db.sql.Bit, c1.esCorrecta ? 1 : 0)
                .input("alt2", db.sql.BigInt, alt2Id)
                .input("correcta2", db.sql.Bit, correcta2)
                .input("intentos", db.sql.TinyInt, intentosUsados)
                .input("resultado", db.sql.VarChar(20), resultado)
                .input("tiempo", db.sql.Int, tiempoSeg)
                .query(`
                    INSERT INTO auris.respuesta_pregunta
                        (evaluacion_id, pregunta_id, orden_presentacion,
                         alternativa_intento1_id, correcta_intento1,
                         alternativa_intento2_id, correcta_intento2,
                         intentos_usados, resultado, tiempo_segundos)
                    VALUES (@evaluacion_id, @pregunta_id, @orden,
                            @alt1, @correcta1,
                            @alt2, @correcta2,
                            @intentos, @resultado, @tiempo);
                `);
        }

        // 3. Actualizar totales en la evaluación
        const porcentaje =
            totalPreguntas > 0
                ? Math.round(((aciertosPrimer + aciertosSegundo) / totalPreguntas) * 10000) / 100
                : 0;

        await new db.sql.Request(tx)
            .input("evaluacion_id", db.sql.BigInt, evaluacionId)
            .input("total", db.sql.SmallInt, totalPreguntas)
            .input("ap", db.sql.SmallInt, aciertosPrimer)
            .input("as", db.sql.SmallInt, aciertosSegundo)
            .input("inc", db.sql.SmallInt, incorrectas)
            .input("pct", db.sql.Decimal(5, 2), porcentaje)
            .query(`
                UPDATE auris.evaluacion
                SET    total_preguntas = @total,
                       aciertos_primer = @ap,
                       aciertos_segundo = @as,
                       incorrectas = @inc,
                       porcentaje_global = @pct
                WHERE  evaluacion_id = @evaluacion_id;
            `);

        await tx.commit();
        return {
            evaluacion_id: evaluacionId,
            evaluacion_uuid: evaluacionUuid,
            total_preguntas: totalPreguntas,
            aciertos_primer: aciertosPrimer,
            aciertos_segundo: aciertosSegundo,
            incorrectas: incorrectas,
            porcentaje_global: porcentaje,
        };
    } catch (e) {
        logger.log(`${TAG_ERR} enviarEvaluacionCompleta rollback: ${e.message}`, e);
        try { await tx.rollback(); } catch (_) {}
        throw e;
    }
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
    resolverIdPorUuid,
    obtenerInforme,
    obtenerDetallePorPregunta,
    obtenerInformeCompletoPorPregunta,
    marcarInformeEnviado,
    // Flujo "no persistir incompletas" (auditoría 2026-05-28)
    corregirIntento,
    enviarEvaluacionCompleta,
};
