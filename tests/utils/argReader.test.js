"use strict";

/**
 * Tests unitarios de base/utils/argReader.js
 *  - leerArg: parsea { arg: JSON } o JSON puro; ante JSON inválido devuelve {}
 *    sin tirar (y loguea por global.logger).
 *  - RE_CORREO: regex de formato de correo (válidos / inválidos).
 */

const { leerArg, RE_CORREO } = require("../../base/utils/argReader");

describe("argReader.leerArg", () => {
    test("parsea body.arg como JSON urlencoded", () => {
        const req = { body: { arg: JSON.stringify({ a: 1, b: "x" }) } };
        expect(leerArg(req)).toEqual({ a: 1, b: "x" });
    });

    test("devuelve body plano cuando no hay arg string", () => {
        const req = { body: { a: 1 } };
        expect(leerArg(req)).toEqual({ a: 1 });
    });

    test("body undefined devuelve {}", () => {
        expect(leerArg({})).toEqual({});
    });

    test("arg JSON malformado devuelve {} sin tirar", () => {
        const req = { body: { arg: "{esto-no-es-json" } };
        expect(() => leerArg(req)).not.toThrow();
        expect(leerArg(req)).toEqual({});
    });

    test("loguea via global.logger ante arg inválido (con tag)", () => {
        const spy = jest.spyOn(global.logger, "log").mockImplementation(() => {});
        const req = { body: { arg: "no-json" } };
        leerArg(req, { tag: "[TEST]" });
        expect(spy).toHaveBeenCalled();
        expect(spy.mock.calls[0][0]).toMatch(/\[TEST\]/);
        spy.mockRestore();
    });
});

describe("argReader.RE_CORREO", () => {
    test.each([
        "ana@uv.cl",
        "alumno@correo.uv.cl",
        "a.b+tag@dominio.com",
        "x@y.io",
    ])("acepta correo válido: %s", (correo) => {
        expect(RE_CORREO.test(correo)).toBe(true);
    });

    test.each([
        "no-es-correo",
        "sin-arroba.cl",
        "@uv.cl",
        "ana@",
        "ana@uv",        // sin punto en dominio
        "ana @uv.cl",    // espacio
        "ana@uv .cl",
        "",
    ])("rechaza correo inválido: %s", (correo) => {
        expect(RE_CORREO.test(correo)).toBe(false);
    });
});
