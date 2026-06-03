"use strict";

/**
 * Tests unitarios de base/utils/reply.js
 *  - envelope ok / error / fatal.
 *  - trace OMITIDO en NODE_ENV='production' (confidencialidad ISO 25010),
 *    PRESENTE en desarrollo.
 *
 * NODE_ENV se lee en cada llamada, así que lo alternamos por test.
 */

const reply = require("../../base/utils/reply");

describe("reply.ok", () => {
    test("envuelve data con status OK", () => {
        const r = reply.ok({ x: 1 });
        expect(r.status).toBe("OK");
        expect(r.data).toEqual({ x: 1 });
        expect(r.error).toBeUndefined();
    });

    test("sin data no incluye campo data", () => {
        const r = reply.ok();
        expect(r.status).toBe("OK");
        expect(r.data).toBeUndefined();
    });

    test("clona la data (no referencia el objeto original)", () => {
        const original = { x: 1 };
        const r = reply.ok(original);
        r.data.x = 999;
        expect(original.x).toBe(1);
    });
});

describe("reply.error", () => {
    test("string produce envelope de error con message", () => {
        const r = reply.error("algo falló");
        expect(r.status).toBe("ERROR");
        expect(r.error.type).toBe("ERROR");
        expect(r.error.message).toBe("algo falló");
        expect(r.data).toBeUndefined();
    });

    test("usa el code provisto o el code por defecto '0'", () => {
        expect(reply.error("x", "42").error.code).toBe("42");
        expect(reply.error("x").error.code).toBe("0");
    });
});

describe("reply — trace según NODE_ENV", () => {
    const prev = process.env.NODE_ENV;
    afterEach(() => {
        process.env.NODE_ENV = prev;
    });

    test("en production el trace de un Error se OMITE (queda vacío)", () => {
        process.env.NODE_ENV = "production";
        const r = reply.error(new Error("boom"));
        expect(r.error.message).toBe("boom");
        expect(r.error.trace).toBe("");
    });

    test("en desarrollo el trace de un Error SÍ está presente", () => {
        process.env.NODE_ENV = "development";
        const r = reply.error(new Error("boom"));
        expect(r.error.message).toBe("boom");
        // El stack se divide por líneas → array no vacío.
        expect(Array.isArray(r.error.trace)).toBe(true);
        expect(r.error.trace.length).toBeGreaterThan(0);
        expect(r.error.trace.join("\n")).toMatch(/boom/);
    });
});

describe("reply.fatal", () => {
    const prev = process.env.NODE_ENV;
    afterEach(() => {
        process.env.NODE_ENV = prev;
    });

    test("Error produce type FATAL", () => {
        const r = reply.fatal(new Error("kaboom"));
        expect(r.status).toBe("ERROR");
        expect(r.error.type).toBe("FATAL");
        expect(r.error.message).toBe("kaboom");
    });

    test("fatal también omite trace en production", () => {
        process.env.NODE_ENV = "production";
        const r = reply.fatal(new Error("kaboom"));
        expect(r.error.trace).toBe("");
    });

    test("string simple produce type FATAL", () => {
        const r = reply.fatal("mensaje plano");
        expect(r.error.type).toBe("FATAL");
        expect(r.error.message).toBe("mensaje plano");
    });
});
