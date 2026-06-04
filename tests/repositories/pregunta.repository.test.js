"use strict";

/**
 * Tests UNITARIOS deterministas de pregunta.repository.
 * db (mssql) totalmente mockeado vía tests/helpers/mockDb.
 *
 * Foco en la LÓGICA testeable: ramas de propiedad (FORBIDDEN), inexistencia
 * (NOT_FOUND), bloqueo por evaluaciones finalizadas (LOCKED), mapeo de
 * recordsets y commit/rollback transaccional.
 */

jest.mock("../../base/utils/db", () => {
    const { createDbHarness } = require("../helpers/mockDb");
    const harness = createDbHarness();
    harness.db.__harness = harness;
    return harness.db;
});

const db = require("../../base/utils/db");
const harness = db.__harness;
const repo = require("../../proyecto/repositories/pregunta.repository");

beforeEach(() => harness.reset());

describe("crearPreguntaConAlternativas", () => {
    test("inserta pregunta + N alternativas en transacción y commitea", async () => {
        harness.queueResults([
            { recordset: [{ pregunta_id: 50 }] }, // INSERT pregunta OUTPUT
            { rowsAffected: [1] }, // alternativa 1
            { rowsAffected: [1] }, // alternativa 2
        ]);

        const id = await repo.crearPreguntaConAlternativas({
            enunciado: "¿Qué soplo?",
            explicacionClinica: "exp",
            audioGridId: null,
            imagenGridId: null,
            videoGridId: null,
            creadoPor: 7,
            cursoOrigenId: null,
            alternativas: [
                { texto: "A", esCorrecta: true, orden: 1 },
                { texto: "B", esCorrecta: false, orden: 2 },
            ],
        });

        expect(id).toBe(50);
        expect(harness.tx.begin).toBe(1);
        expect(harness.tx.commit).toBe(1);
        expect(harness.tx.rollback).toBe(0);
        // Una query por la pregunta + 2 por las alternativas.
        expect(harness.queries).toHaveLength(3);
        expect(harness.queries[0].inputs).toMatchObject({ enunciado: "¿Qué soplo?", creado_por: 7 });
    });

    test("fallo insertando alternativa → rollback y propaga", async () => {
        harness.queueResults([
            { recordset: [{ pregunta_id: 50 }] },
            new Error("alt boom"),
        ]);

        await expect(
            repo.crearPreguntaConAlternativas({
                enunciado: "x",
                explicacionClinica: "e",
                creadoPor: 1,
                alternativas: [{ texto: "A", esCorrecta: true, orden: 1 }],
            })
        ).rejects.toThrow("alt boom");
        expect(harness.tx.commit).toBe(0);
        expect(harness.tx.rollback).toBe(1);
    });
});

describe("listarPorProfesor", () => {
    test("sin paginación → pasa profesor_id y devuelve recordset", async () => {
        const filas = [{ pregunta_id: 1, enunciado: "P", cantidad_alternativas: 4 }];
        harness.queueResult({ recordset: filas });

        const out = await repo.listarPorProfesor(7);

        expect(out).toEqual(filas);
        expect(harness.queries[0].inputs).toMatchObject({ profesor_id: 7 });
        // Sin paginación no se incluyen offset/limit.
        expect(harness.queries[0].inputs.limit).toBeUndefined();
    });

    test("profesorId null → input profesor_id null (lista todas)", async () => {
        harness.queueResult({ recordset: [] });
        await repo.listarPorProfesor(null);
        expect(harness.queries[0].inputs.profesor_id).toBeNull();
    });

    test("con limit/offset válidos → agrega paginación", async () => {
        harness.queueResult({ recordset: [] });
        await repo.listarPorProfesor(7, { limit: 10, offset: 20 });
        expect(harness.queries[0].inputs).toMatchObject({ limit: 10, offset: 20 });
        expect(harness.queries[0].sql).toMatch(/OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY/);
    });
});

describe("obtenerConAlternativas", () => {
    test("existe → adjunta alternativas a la pregunta", async () => {
        harness.queueResults([
            { recordset: [{ pregunta_id: 9, enunciado: "P9" }] },
            { recordset: [{ alternativa_id: 1, texto: "A", es_correcta: 1, orden: 1 }] },
        ]);

        const out = await repo.obtenerConAlternativas(9);

        expect(out.pregunta_id).toBe(9);
        expect(out.alternativas).toHaveLength(1);
        expect(out.alternativas[0].alternativa_id).toBe(1);
    });

    test("no existe → null (no consulta alternativas)", async () => {
        harness.queueResult({ recordset: [] });
        expect(await repo.obtenerConAlternativas(9)).toBeNull();
        expect(harness.queries).toHaveLength(1);
    });
});

describe("editarPreguntaConAlternativas", () => {
    test("pregunta inexistente → NOT_FOUND + rollback", async () => {
        harness.queueResult({ recordset: [] }); // check de propiedad

        const out = await repo.editarPreguntaConAlternativas(9, { alternativas: [] }, 7);

        expect(out).toMatchObject({ ok: false, reason: "NOT_FOUND" });
        expect(harness.tx.rollback).toBe(1);
        expect(harness.tx.commit).toBe(0);
    });

    test("otro dueño → FORBIDDEN + rollback", async () => {
        harness.queueResult({
            recordset: [{ pregunta_id: 9, creado_por: 100, activo: 1 }],
        });

        const out = await repo.editarPreguntaConAlternativas(9, { alternativas: [] }, 7);

        expect(out).toMatchObject({ ok: false, reason: "FORBIDDEN" });
        expect(harness.tx.rollback).toBe(1);
    });

    test("pregunta con evaluaciones finalizadas → LOCKED + rollback", async () => {
        harness.queueResults([
            { recordset: [{ pregunta_id: 9, creado_por: 7, activo: 1, enunciado: "x" }] }, // check
            { recordset: [{ evaluaciones_finalizadas: 2 }] }, // lock
        ]);

        const out = await repo.editarPreguntaConAlternativas(9, { alternativas: [] }, 7);

        expect(out).toMatchObject({ ok: false, reason: "LOCKED", evaluacionesFinalizadas: 2 });
        expect(harness.tx.rollback).toBe(1);
    });

    test("camino feliz → actualiza, reinserta alternativas y commitea", async () => {
        harness.queueResults([
            { recordset: [{ pregunta_id: 9, creado_por: 7, activo: 1, enunciado: "viejo" }] }, // check
            { recordset: [{ evaluaciones_finalizadas: 0 }] }, // lock libre
            { rowsAffected: [1] }, // UPDATE pregunta
            { rowsAffected: [1] }, // DELETE alternativas no usadas
            { recordset: [{ max_orden: 2 }] }, // MAX orden
            { rowsAffected: [2] }, // limpiar es_correcta
            { rowsAffected: [1] }, // INSERT alt nueva
        ]);

        const out = await repo.editarPreguntaConAlternativas(
            9,
            { enunciado: "nuevo", explicacionClinica: "e", alternativas: [{ texto: "A", esCorrecta: true, orden: 1 }] },
            7
        );

        expect(out.ok).toBe(true);
        expect(out.antes).toMatchObject({ enunciado: "viejo" });
        expect(harness.tx.commit).toBe(1);
        expect(harness.tx.rollback).toBe(0);
    });
});

describe("eliminarPregunta", () => {
    test("no existe → NOT_FOUND, no abre transacción", async () => {
        harness.queueResult({ recordset: [] });

        const out = await repo.eliminarPregunta(9, 7);

        expect(out).toMatchObject({ ok: false, reason: "NOT_FOUND" });
        expect(harness.tx.begin).toBe(0);
    });

    test("ya inactiva → ALREADY_INACTIVE", async () => {
        harness.queueResult({ recordset: [{ creado_por: 7, activo: 0 }] });
        const out = await repo.eliminarPregunta(9, 7);
        expect(out).toMatchObject({ ok: false, reason: "ALREADY_INACTIVE" });
        expect(harness.tx.begin).toBe(0);
    });

    test("otro dueño → FORBIDDEN", async () => {
        harness.queueResult({ recordset: [{ creado_por: 100, activo: 1 }] });
        const out = await repo.eliminarPregunta(9, 7);
        expect(out).toMatchObject({ ok: false, reason: "FORBIDDEN" });
        expect(harness.tx.begin).toBe(0);
    });

    test("éxito → soft-delete + desvincula tests, commit", async () => {
        harness.queueResults([
            { recordset: [{ creado_por: 7, activo: 1 }] }, // check
            { rowsAffected: [1] }, // UPDATE activo=0
            { recordset: [{ desvinculados: 3 }] }, // DELETE test_pregunta + SELECT @@ROWCOUNT
        ]);

        const out = await repo.eliminarPregunta(9, 7);

        expect(out).toMatchObject({ ok: true, tests_desvinculados: 3 });
        expect(harness.tx.commit).toBe(1);
        expect(harness.tx.rollback).toBe(0);
    });
});

describe("desvincularDeTest", () => {
    test("queda huérfana sin respuestas → soft-delete", async () => {
        harness.queueResults([
            { rowsAffected: [1] }, // DELETE junction
            { recordset: [{ en_tests: 0, respuestas: 0 }] }, // conteo
            { rowsAffected: [1] }, // UPDATE activo=0
        ]);

        const out = await repo.desvincularDeTest(9, 3);
        expect(out).toEqual({ huerfanaEliminada: true });
    });

    test("sigue en otros tests → NO se elimina", async () => {
        harness.queueResults([
            { rowsAffected: [1] },
            { recordset: [{ en_tests: 2, respuestas: 0 }] },
        ]);

        const out = await repo.desvincularDeTest(9, 3);
        expect(out).toEqual({ huerfanaEliminada: false });
        // No debió ejecutarse la 3ª query (UPDATE activo).
        expect(harness.queries).toHaveLength(2);
    });

    test("tiene respuestas → NO se elimina aunque esté huérfana", async () => {
        harness.queueResults([
            { rowsAffected: [1] },
            { recordset: [{ en_tests: 0, respuestas: 5 }] },
        ]);

        const out = await repo.desvincularDeTest(9, 3);
        expect(out).toEqual({ huerfanaEliminada: false });
    });
});

describe("exportarBanco", () => {
    test("mapea preguntas + alternativas agrupadas", async () => {
        harness.queueResults([
            { recordset: [{ pregunta_id: 1, enunciado: "P1" }, { pregunta_id: 2, enunciado: "P2" }] },
            {
                recordset: [
                    { pregunta_id: 1, alternativa_id: 11, texto: "a", es_correcta: 1, orden: 1 },
                    { pregunta_id: 2, alternativa_id: 21, texto: "b", es_correcta: 0, orden: 1 },
                ],
            },
        ]);

        const out = await repo.exportarBanco(7);

        expect(out).toHaveLength(2);
        expect(out[0].alternativas[0]).toMatchObject({ alternativa_id: 11, es_correcta: true });
        expect(out[1].alternativas[0].es_correcta).toBe(false);
    });

    test("banco vacío → arreglo vacío sin consultar alternativas", async () => {
        harness.queueResult({ recordset: [] });
        expect(await repo.exportarBanco(7)).toEqual([]);
        expect(harness.queries).toHaveLength(1);
    });
});
