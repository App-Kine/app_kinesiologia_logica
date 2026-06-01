"use strict";

/**
 * Repositorio de analítica docente (RF-94 a RF-104).
 * Se apoya en las vistas:
 *   - auris.vw_porcentaje_aplicacion
 *   - auris.vw_stats_pregunta_aplicacion
 * y en consultas directas a evaluacion (respetando privacidad RF-103/RF-104).
 */

var db = require("../../base/utils/db");

/**
 * Lista las aplicaciones de test del profesor con su resumen estadístico.
 * (RF-94, RF-95, RF-96, RF-97 — punto de entrada navegable)
 */
async function resumenPorProfesor(profesorId) {
    const r = await db
        .request("auris")
        .input("profesor_id", db.sql.BigInt, profesorId)
        .query(`
            SELECT  apl.aplicacion_id,
                    apl.curso_id,
                    c.codigo           AS curso_codigo,
                    c.nombre           AS curso_nombre,
                    apl.test_id,
                    t.nombre           AS test_nombre,
                    apl.activo,
                    ISNULL(vp.total_evaluaciones, 0)        AS total_evaluaciones,
                    ISNULL(vp.evaluaciones_anonimas, 0)     AS evaluaciones_anonimas,
                    ISNULL(vp.evaluaciones_identificadas, 0) AS evaluaciones_identificadas,
                    vp.porcentaje_promedio
            FROM    auris.aplicacion_test apl
            JOIN    auris.test  t ON t.test_id  = apl.test_id
            JOIN    auris.curso c ON c.curso_id = apl.curso_id
            LEFT JOIN auris.vw_porcentaje_aplicacion vp
                      ON vp.aplicacion_id = apl.aplicacion_id
            WHERE   apl.profesor_id = @profesor_id
            ORDER BY apl.created_at DESC;
        `);
    return r.recordset;
}

/**
 * Resumen global de una aplicación (RF-98, RF-102).
 */
async function resumenAplicacion(aplicacionId) {
    const r = await db
        .request("auris")
        .input("aplicacion_id", db.sql.BigInt, aplicacionId)
        .query(`
            SELECT  apl.aplicacion_id,
                    apl.curso_id,
                    c.codigo  AS curso_codigo,
                    c.nombre  AS curso_nombre,
                    apl.test_id,
                    t.nombre  AS test_nombre,
                    apl.activo,
                    ISNULL(vp.total_evaluaciones, 0)        AS total_evaluaciones,
                    ISNULL(vp.evaluaciones_anonimas, 0)     AS evaluaciones_anonimas,
                    ISNULL(vp.evaluaciones_identificadas, 0) AS evaluaciones_identificadas,
                    vp.porcentaje_promedio
            FROM    auris.aplicacion_test apl
            JOIN    auris.test  t ON t.test_id  = apl.test_id
            JOIN    auris.curso c ON c.curso_id = apl.curso_id
            LEFT JOIN auris.vw_porcentaje_aplicacion vp
                      ON vp.aplicacion_id = apl.aplicacion_id
            WHERE   apl.aplicacion_id = @aplicacion_id;
        `);
    return r.recordset[0] || null;
}

/**
 * Preguntas de una aplicación ordenadas por tasa de error (RF-99),
 * con total de intentos (RF-100) y errores (RF-101).
 *
 * Pedido cliente 2026-05-26: se agrega tiempo promedio por pregunta
 * (en segundos). Para anónimas e identificadas en conjunto — esto da
 * el dato "agregado anónimo" que el cliente pidió. El detalle individual
 * por estudiante registrado va en evaluacionesConDetallePorAplicacion.
 */
async function preguntasPorAplicacion(aplicacionId) {
    const r = await db
        .request("auris")
        .input("aplicacion_id", db.sql.BigInt, aplicacionId)
        .query(`
            SELECT  s.pregunta_id,
                    p.enunciado,
                    s.total_respuestas,
                    s.aciertos_int1,
                    s.aciertos_int2,
                    s.errores,
                    s.total_intentos,
                    CASE WHEN s.total_respuestas > 0
                         THEN CAST(s.errores AS DECIMAL(5,2)) / s.total_respuestas
                         ELSE 0 END AS tasa_error,
                    -- Tiempo promedio (segundos). NULL si nadie respondió todavía
                    -- o si todas las respuestas son de versiones anteriores a la
                    -- migración del 2026-05-26 (cuando tiempo_segundos no existía).
                    (SELECT AVG(CAST(rp.tiempo_segundos AS DECIMAL(10,2)))
                       FROM auris.respuesta_pregunta rp
                       JOIN auris.evaluacion e ON e.evaluacion_id = rp.evaluacion_id
                      WHERE rp.pregunta_id = s.pregunta_id
                        AND e.aplicacion_id = @aplicacion_id
                        AND rp.tiempo_segundos IS NOT NULL
                    ) AS tiempo_promedio_segundos
            FROM    auris.vw_stats_pregunta_aplicacion s
            JOIN    auris.pregunta p ON p.pregunta_id = s.pregunta_id
            WHERE   s.aplicacion_id = @aplicacion_id
            ORDER BY tasa_error DESC, s.errores DESC;
        `);
    return r.recordset;
}

/**
 * Lista las evaluaciones FINALIZADAS de una aplicación.
 * RF-102: diferencia anónimas/identificadas.
 * RF-103: NUNCA expone correo de anónimas (en BD ya es NULL).
 * RF-104: el correo solo aparece si el estudiante lo registró.
 */
async function evaluacionesPorAplicacion(aplicacionId) {
    const r = await db
        .request("auris")
        .input("aplicacion_id", db.sql.BigInt, aplicacionId)
        .query(`
            SELECT  e.evaluacion_id,
                    e.modalidad,
                    -- Defensa en profundidad: forzamos NULL si por algún motivo
                    -- una anónima tuviera correo (RF-103).
                    CASE WHEN e.modalidad = 'IDENTIFICADA' THEN e.correo_estudiante
                         ELSE NULL END AS correo_estudiante,
                    e.total_preguntas,
                    e.aciertos_primer,
                    e.aciertos_segundo,
                    e.incorrectas,
                    e.porcentaje_global,
                    e.finalizada_en,
                    -- Tiempo total de la evaluación (suma de tiempos por pregunta).
                    -- Pedido cliente 2026-05-26.
                    (SELECT SUM(rp.tiempo_segundos)
                       FROM auris.respuesta_pregunta rp
                      WHERE rp.evaluacion_id = e.evaluacion_id
                        AND rp.tiempo_segundos IS NOT NULL
                    ) AS tiempo_total_segundos
            FROM    auris.evaluacion e
            WHERE   e.aplicacion_id = @aplicacion_id
              AND   e.estado = 'FINALIZADA'
            ORDER BY e.finalizada_en DESC;
        `);
    return r.recordset;
}

/**
 * Tiempos individuales por pregunta para cada evaluación IDENTIFICADA de una
 * aplicación. Esto es el "tiempo particular por persona registrada" que pidió
 * el cliente (2026-05-26). Para anónimos se muestra el promedio agregado en
 * preguntasPorAplicacion. RF-103: NUNCA exponemos correo de anónimas.
 */
async function tiemposPorEvaluacionPregunta(aplicacionId) {
    const r = await db
        .request("auris")
        .input("aplicacion_id", db.sql.BigInt, aplicacionId)
        .query(`
            SELECT  e.evaluacion_id,
                    e.modalidad,
                    CASE WHEN e.modalidad = 'IDENTIFICADA' THEN e.correo_estudiante
                         ELSE NULL END AS correo_estudiante,
                    rp.pregunta_id,
                    rp.orden_presentacion,
                    rp.resultado,
                    rp.intentos_usados,
                    rp.tiempo_segundos
            FROM    auris.respuesta_pregunta rp
            JOIN    auris.evaluacion e ON e.evaluacion_id = rp.evaluacion_id
            WHERE   e.aplicacion_id = @aplicacion_id
              AND   e.estado = 'FINALIZADA'
              AND   e.modalidad = 'IDENTIFICADA'
              AND   rp.tiempo_segundos IS NOT NULL
            ORDER BY e.finalizada_en DESC, rp.orden_presentacion;
        `);
    return r.recordset;
}

module.exports = {
    resumenPorProfesor,
    resumenAplicacion,
    preguntasPorAplicacion,
    evaluacionesPorAplicacion,
    tiemposPorEvaluacionPregunta,
};
