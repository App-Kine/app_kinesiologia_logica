"use strict";

/**
 * Tests unitarios de base/utils/seguridad.js
 *  - escapeHtml: escapa &, <, >, " (mitigación XSS en correos/informes).
 *  - maskEmail: enmascara PII para logs (a***@dominio) + casos borde.
 *
 * Deterministas, sin BD ni red.
 */

const { escapeHtml, maskEmail } = require("../../base/utils/seguridad");

describe("seguridad.escapeHtml", () => {
    test("escapa los caracteres HTML peligrosos", () => {
        expect(escapeHtml("<b>")).toBe("&lt;b&gt;");
        expect(escapeHtml("a & b")).toBe("a &amp; b");
        expect(escapeHtml('say "hi"')).toBe("say &quot;hi&quot;");
    });

    test("escapa & primero para no doble-escapar entidades", () => {
        // Si < se escapara antes que &, '&lt;' se convertiría en '&amp;lt;'.
        expect(escapeHtml("<")).toBe("&lt;");
        expect(escapeHtml("&lt;")).toBe("&amp;lt;");
    });

    test("neutraliza un intento de inyección de <script>", () => {
        const out = escapeHtml('<script>alert("x")</script>');
        expect(out).not.toMatch(/<script>/);
        expect(out).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    });

    test("null y undefined producen string vacío (no 'null'/'undefined')", () => {
        expect(escapeHtml(null)).toBe("");
        expect(escapeHtml(undefined)).toBe("");
    });

    test("coerciona valores no-string", () => {
        expect(escapeHtml(123)).toBe("123");
        expect(escapeHtml(0)).toBe("0");
    });

    test("texto sin caracteres especiales se devuelve igual", () => {
        expect(escapeHtml("Ana Perez")).toBe("Ana Perez");
    });
});

describe("seguridad.maskEmail", () => {
    test("enmascara dejando solo la primera letra del local", () => {
        expect(maskEmail("ana@uv.cl")).toBe("a***@uv.cl");
        expect(maskEmail("alumno@correo.uv.cl")).toBe("a***@correo.uv.cl");
    });

    test("nunca filtra el local completo", () => {
        const masked = maskEmail("nombre.apellido@uv.cl");
        expect(masked).toBe("n***@uv.cl");
        expect(masked).not.toContain("ombre");
        expect(masked).not.toContain("apellido");
    });

    test("string sin @ devuelve marcador genérico", () => {
        expect(maskEmail("no-es-correo")).toBe("(correo inválido)");
    });

    test("@ al inicio (local vacío) es inválido", () => {
        expect(maskEmail("@uv.cl")).toBe("(correo inválido)");
    });

    test("vacío / nulo / no-string devuelven '(sin correo)'", () => {
        expect(maskEmail("")).toBe("(sin correo)");
        expect(maskEmail(null)).toBe("(sin correo)");
        expect(maskEmail(undefined)).toBe("(sin correo)");
        expect(maskEmail(12345)).toBe("(sin correo)");
    });
});
