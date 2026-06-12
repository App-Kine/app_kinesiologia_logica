"use strict";

/**
 * Tests UNITARIOS deterministas de aplicacion.repository.
 * db (mssql) totalmente mockeado vía tests/helpers/mockDb.
 *
 * Foco: filtros por dueño (RNF-19 write-IDOR), mapeo de DUPLICATE,
 * paginación opcional y resultado booleano de setActivo.
 */

jest.mock("../../base/utils/db", () => {
    const { createDbHarness } = require("../helpers/mockDb");
    const harness = createDbHarness();
    harness.db.__harness = harness;
    return harness.db;
});

const db = require("../../base/utils/db");
const harness = db.__harness;
const repo = require("../../proyecto/repositories/aplicacion.repository");

beforeEach(() => harness.reset());

describe("profesorPerteneceACurso", () => {
    test("fila presente → true", async () => {
        harness.queueResult({ recordset: [{ ok: 1 }] });
        const out = await repo.profesorPerteneceACurso(7, 3);
        expect(out).toBe(true);
        expect(harness.queries[0].inputs).toMatchObject({ usuario_id: 7, curso_id: 3 });
    });

    test("sin fila → false", async () => {
        harness.queueResult({ recordset: [] });
        expect(await repo.profesorPerteneceACurso(7, 3)).toBe(false);
    });
});

describe("crearAplicacion", () => {
    test("éxito → devuelve { aplicacion_id, aplicacion_uuid }", async () => {
        harness.queueResult({ recordset: [{ aplicacion_id: 9, aplicacion_uuid: "u-9" }] });

        const out = await repo.crearAplicacion(10, 3, 7);

        expect(out).toEqual({ aplicacion_id: 9, aplicacion_uuid: "u-9" });
        expect(harness.queries[0].inputs).toMatchObject({ test_id: 10, curso_id: 3, profesor_id: 7 });
    });

    test("violación de unicidad (2627) → DUPLICATE", async () => {
        const e = new Error("dup");
        e.number = 2627;
        harness.queueResult(e);

        await expect(repo.crearAplicacion(10, 3, 7)).rejects.toMatchObject({ code: "DUPLICATE" });
    });

    test("otro error de BD → se propaga sin enmascarar", async () => {
        const e = new Error("timeout");
        e.number = 999;
        harness.queueResult(e);

        await expect(repo.crearAplicacion(10, 3, 7)).rejects.toThrow("timeout");
    });
});

describe("listarPorProfesor", () => {
    test("ambos filtros null → inputs null (sin filtro)", async () => {
        harness.queueResult({ recordset: [] });
        await repo.listarPorProfesor(null, null);
        expect(harness.queries[0].inputs).toMatchObject({ profesor_id: null, curso_id: null });
        expect(harness.queries[0].inputs.limit).toBeUndefined();
    });

    test("con profesor + curso → pasa ambos ids", async () => {
        const filas = [{ aplicacion_id: 1, test_nombre: "T", curso_nombre: "C" }];
        harness.queueResult({ recordset: filas });

        const out = await repo.listarPorProfesor(7, 3);

        expect(out).toEqual(filas);
        expect(harness.queries[0].inputs).toMatchObject({ profesor_id: 7, curso_id: 3 });
    });

    test("paginación válida → agrega OFFSET/FETCH e inputs", async () => {
        harness.queueResult({ recordset: [] });
        await repo.listarPorProfesor(7, null, { limit: 5, offset: 10 });
        expect(harness.queries[0].inputs).toMatchObject({ limit: 5, offset: 10 });
        expect(harness.queries[0].sql).toMatch(/OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY/);
    });
});

describe("setActivo", () => {
    test("afecta filas (dueño correcto) → true, pasa profesor_id", async () => {
        harness.queueResult({ recordset: [{ filas: 1 }] });

        const out = await repo.setActivo(9, false, 7);

        expect(out).toBe(true);
        expect(harness.queries[0].inputs).toMatchObject({ aplicacion_id: 9, activo: 0, profesor_id: 7 });
    });

    test("0 filas (no es su aplicación, write-IDOR bloqueado) → false", async () => {
        harness.queueResult({ recordset: [{ filas: 0 }] });
        expect(await repo.setActivo(9, true, 7)).toBe(false);
    });

    test("sin profesorId → input null (no filtra por dueño)", async () => {
        harness.queueResult({ recordset: [{ filas: 1 }] });
        await repo.setActivo(9, true, null);
        expect(harness.queries[0].inputs.profesor_id).toBeNull();
    });
});

describe("reordenar", () => {
    test("asigna orden 1..N en el orden recibido y filtra por curso", async () => {
        harness.queueResult({ recordset: [{ filas: 1 }] });
        harness.queueResult({ recordset: [{ filas: 1 }] });
        harness.queueResult({ recordset: [{ filas: 1 }] });

        const out = await repo.reordenar(3, [20, 10, 30]);

        expect(out).toBe(3);
        expect(harness.queries[0].inputs).toMatchObject({ orden: 1, aplicacion_id: 20, curso_id: 3 });
        expect(harness.queries[1].inputs).toMatchObject({ orden: 2, aplicacion_id: 10, curso_id: 3 });
        expect(harness.queries[2].inputs).toMatchObject({ orden: 3, aplicacion_id: 30, curso_id: 3 });
    });

    test("una aplicación que no es del curso (0 filas) no se cuenta", async () => {
        harness.queueResult({ recordset: [{ filas: 1 }] });
        harness.queueResult({ recordset: [{ filas: 0 }] });

        const out = await repo.reordenar(3, [20, 99]);

        expect(out).toBe(1);
    });
});
