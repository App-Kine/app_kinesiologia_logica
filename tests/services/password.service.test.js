"use strict";

/**
 * Tests de password.service (RF-59).
 *
 * Cubre:
 *  - solicitar: respuesta NEUTRA anti-enumeración (mismo mensaje exista o no
 *    el correo), y el HTML del correo ESCAPA el nombre (no inyecta HTML).
 *  - resetear: validación de política y token.
 *
 * pwRepo + mailer mockeados: sin BD ni SMTP.
 */

jest.mock("../../proyecto/repositories/password.repository", () => ({
    buscarUsuarioActivoPorCorreo: jest.fn(),
    invalidarResetsPrevios: jest.fn(),
    crearReset: jest.fn(),
    buscarPorTokenHash: jest.fn(),
    aplicarNuevaPassword: jest.fn(),
    obtenerPorId: jest.fn(),
    cambiarPasswordPorId: jest.fn(),
}));
jest.mock("../../base/utils/mailer", () => ({ send: jest.fn() }));

const pwRepo = require("../../proyecto/repositories/password.repository");
const mailer = require("../../base/utils/mailer");
const pwService = require("../../proyecto/services/password.service");
const { mockRequest, mockResponse } = require("../helpers/mockResponse");

beforeAll(() => {
    global.config = global.config || {};
    global.config.frontend = { baseUrl: "http://localhost:4200" };
    global.config.security = { bcryptRounds: 4 }; // bajo para tests rápidos
});

describe("password.service.solicitar — anti-enumeración", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mailer.send.mockResolvedValue({ delivered: false, mode: "dev", devLink: "http://x" });
    });

    test("correo inválido → error de formato", async () => {
        const req = mockRequest({ correo: "no-es-correo" });
        const res = mockResponse();
        await pwService.solicitar(req, res);
        expect(res.jsonBody.error.message).toMatch(/Correo inválido/);
        expect(pwRepo.buscarUsuarioActivoPorCorreo).not.toHaveBeenCalled();
    });

    test("correo NO registrado → RECHAZA con error y NO envía correo", async () => {
        pwRepo.buscarUsuarioActivoPorCorreo.mockResolvedValue(null);
        const req = mockRequest({ correo: "fantasma@uv.cl" });
        const res = mockResponse();
        await pwService.solicitar(req, res);

        expect(res.jsonBody.status).toBe("ERROR");
        expect(res.jsonBody.error.message).toMatch(/No existe una cuenta/i);
        expect(mailer.send).not.toHaveBeenCalled();
    });

    test("correo registrado → OK y envía el correo de reseteo", async () => {
        pwRepo.buscarUsuarioActivoPorCorreo.mockResolvedValue({
            usuario_id: 7,
            nombre: "Ana",
        });
        const req = mockRequest({ correo: "ana@uv.cl" });
        const res = mockResponse();
        await pwService.solicitar(req, res);

        expect(res.jsonBody.error).toBeUndefined();
        expect(res.jsonBody.data.mensaje).toMatch(/enlace para restablecer/i);
        expect(mailer.send).toHaveBeenCalledTimes(1);
    });

    test("el HTML del correo ESCAPA el nombre (no inyecta HTML)", async () => {
        pwRepo.buscarUsuarioActivoPorCorreo.mockResolvedValue({
            usuario_id: 7,
            nombre: '<script>alert(1)</script>',
        });
        const req = mockRequest({ correo: "ana@uv.cl" });
        const res = mockResponse();
        await pwService.solicitar(req, res);

        const arg = mailer.send.mock.calls[0][0];
        expect(arg.html).not.toMatch(/<script>/);
        expect(arg.html).toMatch(/&lt;script&gt;/);
    });
});

describe("password.service.resetear — validación", () => {
    beforeEach(() => jest.clearAllMocks());

    test("rechaza token vacío", async () => {
        const req = mockRequest({ token: "", password: "Abcdef1!gh" });
        const res = mockResponse();
        await pwService.resetear(req, res);
        expect(res.jsonBody.error.message).toMatch(/Token requerido/);
    });

    test("rechaza password que no cumple política RNF-13", async () => {
        const req = mockRequest({ token: "tok", password: "corta" });
        const res = mockResponse();
        await pwService.resetear(req, res);
        expect(res.jsonBody.error.message).toMatch(/debe incluir/);
        expect(pwRepo.buscarPorTokenHash).not.toHaveBeenCalled();
    });

    test("token inexistente → 'Enlace inválido'", async () => {
        pwRepo.buscarPorTokenHash.mockResolvedValue(null);
        const req = mockRequest({ token: "tok", password: "Abcdef1!gh" });
        const res = mockResponse();
        await pwService.resetear(req, res);
        expect(res.jsonBody.error.message).toMatch(/Enlace inválido/);
    });

    test("token ya usado → rechaza", async () => {
        pwRepo.buscarPorTokenHash.mockResolvedValue({
            reset_id: 1, usuario_id: 7, usado_en: "2026-06-01",
            expira_en: new Date(Date.now() + 3600000),
        });
        const req = mockRequest({ token: "tok", password: "Abcdef1!gh" });
        const res = mockResponse();
        await pwService.resetear(req, res);
        expect(res.jsonBody.error.message).toMatch(/ya fue utilizado/);
    });

    test("token expirado → rechaza", async () => {
        pwRepo.buscarPorTokenHash.mockResolvedValue({
            reset_id: 1, usuario_id: 7, usado_en: null,
            expira_en: new Date(Date.now() - 1000),
        });
        const req = mockRequest({ token: "tok", password: "Abcdef1!gh" });
        const res = mockResponse();
        await pwService.resetear(req, res);
        expect(res.jsonBody.error.message).toMatch(/expiró/);
    });

    test("token válido → aplica nueva password (bcrypt)", async () => {
        pwRepo.buscarPorTokenHash.mockResolvedValue({
            reset_id: 1, usuario_id: 7, usado_en: null,
            expira_en: new Date(Date.now() + 3600000),
        });
        pwRepo.aplicarNuevaPassword.mockResolvedValue(undefined);
        const req = mockRequest({ token: "tok", password: "Abcdef1!gh" });
        const res = mockResponse();
        await pwService.resetear(req, res);
        expect(res.jsonBody.error).toBeUndefined();
        expect(res.jsonBody.data.ok).toBe(true);
        expect(pwRepo.aplicarNuevaPassword).toHaveBeenCalledTimes(1);
    });
});
