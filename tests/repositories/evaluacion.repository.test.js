"use strict";

/**
 * Tests UNITARIOS deterministas de evaluacion.repository.
 *
 * Mockeamos por completo la capa db (mssql) con tests/helpers/mockDb. NADA de
 * BD real: cada query consume un resultado encolado y registramos los inputs
 * para asertar comportamiento (no SQL textual exacto).
 *
 * Cubre:
 *  - corregirIntento (correcta / incorrecta / ALT_INVALIDA)
 *  - resolverIdPorUuid (encontrado / no)
 *  - obtenerInforme (mapeo / null)
 *  - obtenerInformeCompletoPorPregunta (mapeo recordsets + vacío)
 *  - marcarInformeEnviado (input correcto)
 *  - enviarEvaluacionCompleta (commit en éxito / rollback en error)
 */

// El harness se crea dentro de la factory (jest.mock se hoistea) y se expone
// como propiedad del propio mock para recuperarlo luego.
jest.mock("../../base/utils/db", () => {
    const { createDbHarness } = require("../helpers/mockDb");
    const harness = createDbHarness();
    // Adjuntamos el harness al objeto db exportado para poder controlarlo.
    harness.db.__harness = harness;
    return harness.db;
});

const db = require("../../base/utils/db");
const harness = db.__harness;
const repo = require("../../proyecto/repositories/evaluacion.repository");

// _datosCorreccion ejecuta UNA query y devuelve recordset[0] con
// { explicacion_clinica, correcta_id, es_correcta_sel }.
function corrRow({ esCorrectaSel, correctaId = 99, explicacion = "exp" }) {
    return {
        recordset: [
            {
                explicacion_clinica: explicacion,
                correcta_id: correctaId,
                es_correcta_sel: esCorrectaSel,
            },
        ],
    };
}

beforeEach(() => harness.reset());

describe("corregirIntento", () => {
    test("alternativa correcta → revela correcta + explicación", async () => {
        harness.queueResult(corrRow({ esCorrectaSel: 1, correctaId: 7, explicacion: "porque sí" }));

        const out = await repo.corregirIntento(10, 7, 1);

        expect(out.correcta).toBe(true);
        expect(out.finalizadaPregunta).toBe(true);
        expect(out.puedeReintentar).toBe(false);
        expect(out.correctaAlternativaId).toBe(7);
        expect(out.explicacion).toBe("porque sí");
        // Verifica que se pasaron los inputs correctos a la query de corrección.
        expect(harness.queries[0].inputs).toMatchObject({
            pregunta_id: 10,
            alternativa_id: 7,
        });
    });

    test("intento 1 incorrecto → NO revela, permite reintentar", async () => {
        harness.queueResult(corrRow({ esCorrectaSel: 0, correctaId: 7 }));

        const out = await repo.corregirIntento(10, 5, 1);

        expect(out.correcta).toBe(false);
        expect(out.finalizadaPregunta).toBe(false);
        expect(out.puedeReintentar).toBe(true);
        expect(out.correctaAlternativaId).toBeNull();
        expect(out.explicacion).toBeNull();
    });

    test("intento 2 incorrecto → revela igual (no puede reintentar)", async () => {
        harness.queueResult(corrRow({ esCorrectaSel: 0, correctaId: 7, explicacion: "rev" }));

        const out = await repo.corregirIntento(10, 5, 2);

        expect(out.correcta).toBe(false);
        expect(out.finalizadaPregunta).toBe(true);
        expect(out.puedeReintentar).toBe(false);
        expect(out.correctaAlternativaId).toBe(7);
        expect(out.explicacion).toBe("rev");
    });

    test("alternativa que no pertenece (es_correcta_sel null) → ALT_INVALIDA", async () => {
        harness.queueResult(corrRow({ esCorrectaSel: null }));

        await expect(repo.corregirIntento(10, 999, 1)).rejects.toMatchObject({
            code: "ALT_INVALIDA",
        });
    });

    test("pregunta inexistente (recordset vacío) → ALT_INVALIDA", async () => {
        harness.queueResult({ recordset: [] });

        await expect(repo.corregirIntento(10, 1, 1)).rejects.toMatchObject({
            code: "ALT_INVALIDA",
        });
    });
});

describe("resolverIdPorUuid", () => {
    test("encontrado → devuelve número", async () => {
        harness.queueResult({ recordset: [{ evaluacion_id: "42" }] });

        const id = await repo.resolverIdPorUuid("uuid-x");

        expect(id).toBe(42);
        expect(harness.queries[0].inputs).toMatchObject({ evaluacion_uuid: "uuid-x" });
    });

    test("no encontrado → null", async () => {
        harness.queueResult({ recordset: [] });

        const id = await repo.resolverIdPorUuid("uuid-y");
        expect(id).toBeNull();
    });
});

describe("obtenerInforme", () => {
    test("devuelve la primera fila del recordset", async () => {
        const fila = {
            evaluacion_id: 5,
            correo_estudiante: "a@b.cl",
            total_preguntas: 10,
            test_nombre: "Auscultación",
            curso_nombre: "Kine",
        };
        harness.queueResult({ recordset: [fila] });

        const out = await repo.obtenerInforme(5);

        expect(out).toEqual(fila);
        expect(harness.queries[0].inputs).toMatchObject({ evaluacion_id: 5 });
    });

    test("evaluación inexistente → null", async () => {
        harness.queueResult({ recordset: [] });
        expect(await repo.obtenerInforme(123)).toBeNull();
    });
});

describe("obtenerInformeCompletoPorPregunta", () => {
    test("mapea preguntas + agrupa alternativas (con es_correcta normalizada)", async () => {
        // 1ª query: preguntas de la evaluación
        harness.queueResult({
            recordset: [
                {
                    respuesta_id: 1,
                    pregunta_id: 100,
                    orden_presentacion: 1,
                    alternativa_intento1_id: 11,
                    alternativa_intento2_id: null,
                    intentos_usados: 1,
                    resultado: "CORRECTA_INT1",
                    tiempo_segundos: 30,
                    enunciado: "P1",
                    explicacion_clinica: "E1",
                },
                {
                    respuesta_id: 2,
                    pregunta_id: 200,
                    orden_presentacion: 2,
                    alternativa_intento1_id: 21,
                    alternativa_intento2_id: 22,
                    intentos_usados: 2,
                    resultado: "INCORRECTA",
                    tiempo_segundos: 50,
                    enunciado: "P2",
                    explicacion_clinica: "E2",
                },
            ],
        });
        // 2ª query: alternativas de todas las preguntas
        harness.queueResult({
            recordset: [
                { alternativa_id: 11, pregunta_id: 100, texto: "a", es_correcta: 1, orden: 1 },
                { alternativa_id: 12, pregunta_id: 100, texto: "b", es_correcta: 0, orden: 2 },
                { alternativa_id: 21, pregunta_id: 200, texto: "c", es_correcta: false, orden: 1 },
                { alternativa_id: 22, pregunta_id: 200, texto: "d", es_correcta: true, orden: 2 },
            ],
        });

        const out = await repo.obtenerInformeCompletoPorPregunta(7);

        expect(out).toHaveLength(2);
        expect(out[0].pregunta_id).toBe(100);
        expect(out[0].alternativas).toHaveLength(2);
        expect(out[0].alternativas[0]).toMatchObject({ alternativa_id: 11, es_correcta: true });
        expect(out[0].alternativas[1].es_correcta).toBe(false);
        // Pregunta 200: la correcta es la 22 (es_correcta true booleano)
        const p2 = out[1];
        expect(p2.alternativas.find((a) => a.alternativa_id === 22).es_correcta).toBe(true);
        expect(p2.alternativas.find((a) => a.alternativa_id === 21).es_correcta).toBe(false);
        // La query de alternativas recibió un input por cada pregunta (p0, p1)
        expect(harness.queries[1].inputs).toMatchObject({ p0: 100, p1: 200 });
    });

    test("sin respuestas → arreglo vacío y NO consulta alternativas", async () => {
        harness.queueResult({ recordset: [] });

        const out = await repo.obtenerInformeCompletoPorPregunta(7);

        expect(out).toEqual([]);
        // Solo se ejecutó 1 query (la de preguntas), no la de alternativas.
        expect(harness.queries).toHaveLength(1);
    });
});

describe("marcarInformeEnviado", () => {
    test("ejecuta UPDATE con el evaluacion_id correcto", async () => {
        harness.queueResult({ rowsAffected: [1] });

        await repo.marcarInformeEnviado(77);

        expect(harness.queries[0].inputs).toMatchObject({ evaluacion_id: 77 });
        expect(harness.queries[0].sql).toMatch(/informe_enviado_en/i);
    });
});

describe("enviarEvaluacionCompleta", () => {
    // Helper: arma la cola de resultados ANTES de la transacción +
    // dentro de ella, según el flujo del repo.
    function payloadOk() {
        return {
            aplicacionId: 1,
            modalidad: "ANONIMA",
            correo: null,
            respuestas: [
                {
                    preguntaId: 100,
                    ordenPresentacion: 1,
                    alternativaIntento1Id: 11,
                    alternativaIntento2Id: null,
                    tiempoSegundos: 30,
                },
            ],
        };
    }

    test("éxito → commit y resumen correcto", async () => {
        harness.queueResults([
            // obtenerAplicacionActiva
            { recordset: [{ aplicacion_id: 1, test_id: 10, activo: 1, test_nombre: "T", orden_aleatorio: 0, test_activo: 1 }] },
            // COUNT total preguntas
            { recordset: [{ total: 4 }] },
            // _cargarCorreccionBatch: 1) explicación + alternativa correcta por pregunta
            { recordset: [{ pregunta_id: 100, explicacion_clinica: "exp", correcta_id: 11 }] },
            // _cargarCorreccionBatch: 2) alternativas de las preguntas (alt 11 correcta)
            { recordset: [{ alternativa_id: 11, pregunta_id: 100, es_correcta: 1 }] },
            // INSERT evaluacion (OUTPUT)
            { recordset: [{ evaluacion_id: 500, evaluacion_uuid: "uuid-500" }] },
            // INSERT respuesta_pregunta
            { rowsAffected: [1] },
            // UPDATE totales
            { rowsAffected: [1] },
        ]);

        const out = await repo.enviarEvaluacionCompleta(payloadOk());

        expect(out).toMatchObject({
            evaluacion_id: 500,
            evaluacion_uuid: "uuid-500",
            total_preguntas: 4,
            aciertos_primer: 1,
            aciertos_segundo: 0,
            incorrectas: 0,
            porcentaje_global: 25, // 1/4
        });
        expect(harness.tx.begin).toBe(1);
        expect(harness.tx.commit).toBe(1);
        expect(harness.tx.rollback).toBe(0);
    });

    test("aplicación inactiva → APL_INACTIVA antes de abrir transacción", async () => {
        harness.queueResult({ recordset: [] }); // obtenerAplicacionActiva → null

        await expect(repo.enviarEvaluacionCompleta(payloadOk())).rejects.toMatchObject({
            code: "APL_INACTIVA",
        });
        expect(harness.tx.begin).toBe(0);
    });

    test("sin respuestas → SIN_RESPUESTAS, sin transacción", async () => {
        harness.queueResults([
            { recordset: [{ aplicacion_id: 1, test_id: 10, activo: 1, test_activo: 1 }] },
            { recordset: [{ total: 4 }] },
        ]);

        const p = payloadOk();
        p.respuestas = [];

        await expect(repo.enviarEvaluacionCompleta(p)).rejects.toMatchObject({
            code: "SIN_RESPUESTAS",
        });
        expect(harness.tx.begin).toBe(0);
    });

    test("alternativa inválida en pre-validación → ALT_INVALIDA, sin transacción", async () => {
        harness.queueResults([
            { recordset: [{ aplicacion_id: 1, test_id: 10, activo: 1, test_activo: 1 }] },
            { recordset: [{ total: 4 }] },
            // _cargarCorreccionBatch: 1) info de la pregunta 100
            { recordset: [{ pregunta_id: 100, explicacion_clinica: "exp", correcta_id: 11 }] },
            // _cargarCorreccionBatch: 2) alternativas: la 11 (elegida) NO pertenece
            // a la pregunta 100 → resolver(...) devuelve null → ALT_INVALIDA
            { recordset: [{ alternativa_id: 99, pregunta_id: 100, es_correcta: 1 }] },
        ]);

        await expect(repo.enviarEvaluacionCompleta(payloadOk())).rejects.toMatchObject({
            code: "ALT_INVALIDA",
        });
        expect(harness.tx.begin).toBe(0);
    });

    test("fallo DENTRO de la transacción → rollback y propaga el error", async () => {
        harness.queueResults([
            { recordset: [{ aplicacion_id: 1, test_id: 10, activo: 1, test_activo: 1 }] },
            { recordset: [{ total: 4 }] },
            // _cargarCorreccionBatch: info pregunta + alternativas (alt 11 correcta)
            { recordset: [{ pregunta_id: 100, explicacion_clinica: "exp", correcta_id: 11 }] },
            { recordset: [{ alternativa_id: 11, pregunta_id: 100, es_correcta: 1 }] },
            // INSERT evaluacion falla dentro de la transacción
            new Error("boom insert"),
        ]);

        await expect(repo.enviarEvaluacionCompleta(payloadOk())).rejects.toThrow("boom insert");
        expect(harness.tx.begin).toBe(1);
        expect(harness.tx.commit).toBe(0);
        expect(harness.tx.rollback).toBe(1);
    });
});
