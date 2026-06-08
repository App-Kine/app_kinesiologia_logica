"use strict";

/**
 * Tests UNITARIOS deterministas de usuario.repository.
 * db (mssql) totalmente mockeado vía tests/helpers/mockDb.
 *
 * Cubre: findByCorreo, findRoles, correoYaRegistrado,
 * contarIntentosFallidosRecientes, listarUsuarios (mapeo activo/roles),
 * setActivoUsuario (rowsAffected), esUltimoSuperadminActivo,
 * crearUsuarioProfesor (commit / rollback).
 */

jest.mock("../../base/utils/db", () => {
    const { createDbHarness } = require("../helpers/mockDb");
    const harness = createDbHarness();
    harness.db.__harness = harness;
    return harness.db;
});

const db = require("../../base/utils/db");
const harness = db.__harness;
const repo = require("../../proyecto/repositories/usuario.repository");

beforeEach(() => harness.reset());

describe("findByCorreo", () => {
    test("encontrado → devuelve fila con input correcto", async () => {
        const u = { usuario_id: 1, nombre: "Ana", correo: "ana@uv.cl", password_hash: "h", activo: 1 };
        harness.queueResult({ recordset: [u] });

        const out = await repo.findByCorreo("ana@uv.cl");

        expect(out).toEqual(u);
        expect(harness.queries[0].inputs).toMatchObject({ correo: "ana@uv.cl" });
    });

    test("no existe → null", async () => {
        harness.queueResult({ recordset: [] });
        expect(await repo.findByCorreo("x@uv.cl")).toBeNull();
    });
});

describe("findRoles", () => {
    test("mapea recordset a arreglo de códigos", async () => {
        harness.queueResult({ recordset: [{ codigo: "PROFESOR" }, { codigo: "SUPERADMIN" }] });

        const roles = await repo.findRoles(9);

        expect(roles).toEqual(["PROFESOR", "SUPERADMIN"]);
        expect(harness.queries[0].inputs).toMatchObject({ usuario_id: 9 });
    });

    test("sin roles → arreglo vacío", async () => {
        harness.queueResult({ recordset: [] });
        expect(await repo.findRoles(9)).toEqual([]);
    });
});

describe("correoYaRegistrado", () => {
    test("total > 0 → true", async () => {
        harness.queueResult({ recordset: [{ total: 1 }] });
        expect(await repo.correoYaRegistrado("a@uv.cl")).toBe(true);
    });

    test("total = 0 → false", async () => {
        harness.queueResult({ recordset: [{ total: 0 }] });
        expect(await repo.correoYaRegistrado("a@uv.cl")).toBe(false);
    });
});

describe("contarIntentosFallidosRecientes", () => {
    test("devuelve el conteo y pasa correo + minutos", async () => {
        harness.queueResult({ recordset: [{ fallidos: 3 }] });

        const n = await repo.contarIntentosFallidosRecientes("a@uv.cl", 15);

        expect(n).toBe(3);
        expect(harness.queries[0].inputs).toMatchObject({ correo: "a@uv.cl", minutos: 15 });
    });
});

describe("listarUsuarios", () => {
    test("mapea activo a boolean y roles (string) a arreglo", async () => {
        harness.queueResult({
            recordset: [
                { usuario_id: 1, nombre: "Ana", correo: "a@uv.cl", activo: 1, created_at: "2026-01-01", roles: "PROFESOR,SUPERADMIN" },
                { usuario_id: 2, nombre: "Beto", correo: "b@uv.cl", activo: 0, created_at: "2026-01-02", roles: null },
            ],
        });

        const out = await repo.listarUsuarios();

        expect(out[0]).toMatchObject({
            usuario_id: 1,
            activo: true,
            roles: ["PROFESOR", "SUPERADMIN"],
        });
        expect(out[1]).toMatchObject({
            usuario_id: 2,
            activo: false,
            roles: [],
        });
    });

    test("sin usuarios → arreglo vacío", async () => {
        harness.queueResult({ recordset: [] });
        expect(await repo.listarUsuarios()).toEqual([]);
    });
});

describe("setActivoUsuario", () => {
    test("devuelve filas afectadas y pasa activo=1", async () => {
        harness.queueResult({ rowsAffected: [1] });

        const n = await repo.setActivoUsuario(5, true);

        expect(n).toBe(1);
        expect(harness.queries[0].inputs).toMatchObject({ usuario_id: 5, activo: 1 });
    });

    test("desactivar → activo=0; 0 filas si no existe", async () => {
        harness.queueResult({ rowsAffected: [0] });

        const n = await repo.setActivoUsuario(999, false);

        expect(n).toBe(0);
        expect(harness.queries[0].inputs).toMatchObject({ usuario_id: 999, activo: 0 });
    });
});

describe("esUltimoSuperadminActivo", () => {
    test("es super y único activo → true", async () => {
        harness.queueResult({ recordset: [{ esSuper: 1, totalSuperActivos: 1 }] });
        expect(await repo.esUltimoSuperadminActivo(1)).toBe(true);
    });

    test("es super pero hay otros activos → false", async () => {
        harness.queueResult({ recordset: [{ esSuper: 1, totalSuperActivos: 3 }] });
        expect(await repo.esUltimoSuperadminActivo(1)).toBe(false);
    });

    test("no es superadmin → false", async () => {
        harness.queueResult({ recordset: [{ esSuper: 0, totalSuperActivos: 2 }] });
        expect(await repo.esUltimoSuperadminActivo(1)).toBe(false);
    });
});

describe("crearUsuarioProfesor", () => {
    test("éxito → inserta usuario + rol, commit, devuelve id", async () => {
        harness.queueResults([
            { recordset: [{ usuario_id: 321 }] }, // INSERT usuario OUTPUT
            { rowsAffected: [1] }, // INSERT usuario_rol
        ]);

        const id = await repo.crearUsuarioProfesor("Ana", "ana@uv.cl", "bcrypt-hash");

        expect(id).toBe(321);
        expect(harness.tx.begin).toBe(1);
        expect(harness.tx.commit).toBe(1);
        expect(harness.tx.rollback).toBe(0);
        // El primer INSERT recibió nombre/correo/hash
        expect(harness.queries[0].inputs).toMatchObject({
            nombre: "Ana",
            correo: "ana@uv.cl",
            password_hash: "bcrypt-hash",
        });
        // El rol asignado es PROFESOR (id 2)
        expect(harness.queries[1].inputs).toMatchObject({ usuario_id: 321, rol_id: 2 });
    });

    test("fallo en el INSERT del rol → rollback y propaga", async () => {
        harness.queueResults([
            { recordset: [{ usuario_id: 321 }] },
            new Error("fk rol"),
        ]);

        await expect(repo.crearUsuarioProfesor("Ana", "ana@uv.cl", "h")).rejects.toThrow("fk rol");
        expect(harness.tx.commit).toBe(0);
        expect(harness.tx.rollback).toBe(1);
    });
});
