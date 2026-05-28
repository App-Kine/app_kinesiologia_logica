"use strict";

/**
 * Tests del servicio curso. Cubre las validaciones de longitud
 * (auditoría Día 3.2) y la coerción de input.
 *
 * Mock del módulo db para no requerir SQL Server.
 */

jest.mock("../../base/utils/db", () => ({
    sql: {
        BigInt: "BigInt", VarChar: () => "VarChar", NVarChar: () => "NVarChar",
        Bit: "Bit", Transaction: jest.fn().mockImplementation(() => ({
            begin: jest.fn().mockResolvedValue(undefined),
            commit: jest.fn().mockResolvedValue(undefined),
            rollback: jest.fn().mockResolvedValue(undefined),
        })),
        Request: jest.fn().mockImplementation(() => ({
            input: function () { return this; },
            query: jest.fn().mockResolvedValue({ recordset: [] }),
        })),
    },
    getPool: jest.fn().mockReturnValue({
        request: () => ({
            input: function () { return this; },
            query: jest.fn().mockResolvedValue({ recordset: [{ curso_id: 1 }] }),
        }),
    }),
    request: jest.fn(),
}));

const cursoService = require("../../proyecto/services/curso.service");
const { mockRequest, mockResponse } = require("../helpers/mockResponse");

describe("curso.service — validación de longitud (Día 3.2)", () => {
    test("rechaza código > 40 caracteres", async () => {
        const req = mockRequest({
            codigo: "a".repeat(41),
            nombre: "Curso válido",
            creadoPor: 1,
        });
        const res = mockResponse();
        await cursoService.crear(req, res);
        expect(res.jsonBody.error).toBeDefined();
        expect(res.jsonBody.error.message).toMatch(/código.*40/);
    });

    test("rechaza nombre > 160 caracteres", async () => {
        const req = mockRequest({
            codigo: "KINE-401",
            nombre: "x".repeat(161),
            creadoPor: 1,
        });
        const res = mockResponse();
        await cursoService.crear(req, res);
        expect(res.jsonBody.error.message).toMatch(/nombre.*160/);
    });

    test("rechaza descripción > 1000 caracteres", async () => {
        const req = mockRequest({
            codigo: "KINE-401",
            nombre: "Válido",
            descripcion: "y".repeat(1001),
            creadoPor: 1,
        });
        const res = mockResponse();
        await cursoService.crear(req, res);
        expect(res.jsonBody.error.message).toMatch(/descripción.*1000/);
    });

    test("rechaza creadoPor inválido", async () => {
        const req = mockRequest({
            codigo: "KINE-401",
            nombre: "Válido",
            // creadoPor faltante
        });
        const res = mockResponse();
        await cursoService.crear(req, res);
        expect(res.jsonBody.error.message).toMatch(/creadoPor/);
    });

    test("rechaza nombre vacío", async () => {
        const req = mockRequest({
            codigo: "KINE-401",
            nombre: "",
            creadoPor: 1,
        });
        const res = mockResponse();
        await cursoService.crear(req, res);
        expect(res.jsonBody.error.message).toMatch(/nombre requerido/);
    });
});

describe("curso.service._leerArg — robustez del parser", () => {
    test("acepta arg JSON urlencoded", async () => {
        // si _leerArg falla, la validación de campos requeridos disparará error
        const req = { body: { arg: JSON.stringify({ codigo: "K1", nombre: "Test", creadoPor: 1 }) } };
        const res = mockResponse();
        await cursoService.crear(req, res);
        // No es error de "código requerido" → parsing OK
        expect(res.jsonBody.error?.message).not.toMatch(/código requerido/);
    });

    test("logs warning ante arg malformado sin tirar excepción", async () => {
        const req = { body: { arg: "{esto-no-es-json" } };
        const res = mockResponse();
        await cursoService.crear(req, res);
        // Debe devolver error de validación, no fatal
        expect(res.jsonBody.error).toBeDefined();
    });
});
