"use strict";

/**
 * Tests de invitacion.service (RF-76..RF-87, RNF-12).
 *
 * Foco:
 *  - crear: no invita a correos ya registrados; en modo dev expone link y NO
 *    envía (delivered:false).
 *  - completar: el HTML/registro NO se rompe por un nombre con caracteres
 *    especiales y se valida política de password.
 *  - verificar: estados de token (válido/usado/expirado).
 *
 * Repos + mailer mockeados: sin BD ni SMTP.
 */

jest.mock("../../proyecto/repositories/invitacion.repository", () => ({
    ESTADOS: {},
    crearInvitacion: jest.fn(),
    buscarPorTokenHash: jest.fn(),
    buscarPendientePorCorreo: jest.fn(),
    marcarReenviada: jest.fn(),
    marcarCompletada: jest.fn(),
    marcarPendientesVencidasComoExpiradas: jest.fn(),
    listarTodas: jest.fn(),
}));
jest.mock("../../proyecto/repositories/usuario.repository", () => ({
    correoYaRegistrado: jest.fn(),
    crearUsuarioProfesor: jest.fn(),
}));
jest.mock("../../base/utils/mailer", () => ({ send: jest.fn() }));

const invRepo = require("../../proyecto/repositories/invitacion.repository");
const usuarioRepo = require("../../proyecto/repositories/usuario.repository");
const mailer = require("../../base/utils/mailer");
const invService = require("../../proyecto/services/invitacion.service");
const { mockRequest, mockResponse } = require("../helpers/mockResponse");

beforeAll(() => {
    global.config = global.config || {};
    global.config.frontend = { baseUrl: "http://localhost:8100" };
    global.config.invitaciones = { expiraHoras: 24 };
    global.config.security = { bcryptRounds: 4 };
});

describe("invitacion.service.crear", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mailer.send.mockResolvedValue({ delivered: false, mode: "dev", devLink: "x" });
    });

    test("rechaza correo inválido", async () => {
        const req = mockRequest({ correo: "no-es-correo", creadaPor: 1 });
        const res = mockResponse();
        await invService.crear(req, res);
        expect(res.jsonBody.error.message).toMatch(/Correo inválido/);
    });

    test("rechaza sin admin que invita (creadaPor)", async () => {
        const req = mockRequest({ correo: "nuevo@uv.cl" });
        const res = mockResponse();
        await invService.crear(req, res);
        expect(res.jsonBody.error.message).toMatch(/admin que invita/);
    });

    test("rechaza correo ya registrado (RF-86)", async () => {
        usuarioRepo.correoYaRegistrado.mockResolvedValue(true);
        const req = mockRequest({ correo: "existe@uv.cl", creadaPor: 1 });
        const res = mockResponse();
        await invService.crear(req, res);
        expect(res.jsonBody.error.message).toMatch(/Ya existe un usuario/);
        expect(invRepo.crearInvitacion).not.toHaveBeenCalled();
    });

    test("en modo dev expone link y NO envía (delivered:false)", async () => {
        usuarioRepo.correoYaRegistrado.mockResolvedValue(false);
        invRepo.buscarPendientePorCorreo.mockResolvedValue(null);
        invRepo.crearInvitacion.mockResolvedValue(55);

        const req = mockRequest({ correo: "nuevo@uv.cl", creadaPor: 1 });
        const res = mockResponse();
        await invService.crear(req, res);

        expect(res.jsonBody.error).toBeUndefined();
        expect(res.jsonBody.data.invitacion_id).toBe(55);
        expect(res.jsonBody.data.modo).toBe("dev");
        expect(res.jsonBody.data.correo_enviado).toBe(false);
        // En dev el link se expone como respaldo.
        expect(res.jsonBody.data.link).toMatch(/registro-profesor\//);
    });

    test("marca como REENVIADA una invitación pendiente previa (RF-78)", async () => {
        usuarioRepo.correoYaRegistrado.mockResolvedValue(false);
        invRepo.buscarPendientePorCorreo.mockResolvedValue({ invitacion_id: 9 });
        invRepo.crearInvitacion.mockResolvedValue(60);

        const req = mockRequest({ correo: "nuevo@uv.cl", creadaPor: 1 });
        const res = mockResponse();
        await invService.crear(req, res);
        expect(invRepo.marcarReenviada).toHaveBeenCalledWith(9);
    });
});

describe("invitacion.service.verificar", () => {
    beforeEach(() => jest.clearAllMocks());

    test("token vacío → error", async () => {
        const req = mockRequest({ token: "" });
        const res = mockResponse();
        await invService.verificar(req, res);
        expect(res.jsonBody.error.message).toMatch(/Token requerido/);
    });

    test("token inexistente → 'Invitación inválida'", async () => {
        invRepo.buscarPorTokenHash.mockResolvedValue(null);
        const req = mockRequest({ token: "tok" });
        const res = mockResponse();
        await invService.verificar(req, res);
        expect(res.jsonBody.error.message).toMatch(/Invitación inválida/);
    });

    test("COMPLETADA → 'ya fue utilizada'", async () => {
        invRepo.buscarPorTokenHash.mockResolvedValue({
            invitacion_id: 1, estado: "COMPLETADA",
            expira_en: new Date(Date.now() + 3600000),
        });
        const req = mockRequest({ token: "tok" });
        const res = mockResponse();
        await invService.verificar(req, res);
        expect(res.jsonBody.error.message).toMatch(/ya fue utilizada/);
    });

    test("PENDIENTE vigente → devuelve datos", async () => {
        invRepo.buscarPorTokenHash.mockResolvedValue({
            invitacion_id: 1, estado: "PENDIENTE",
            correo_destino: "nuevo@uv.cl",
            expira_en: new Date(Date.now() + 3600000),
        });
        const req = mockRequest({ token: "tok" });
        const res = mockResponse();
        await invService.verificar(req, res);
        expect(res.jsonBody.error).toBeUndefined();
        expect(res.jsonBody.data.correo_destino).toBe("nuevo@uv.cl");
    });
});

describe("invitacion.service.completar", () => {
    beforeEach(() => jest.clearAllMocks());

    test("rechaza password que no cumple política", async () => {
        const req = mockRequest({ token: "tok", nombre: "Ana", password: "debil" });
        const res = mockResponse();
        await invService.completar(req, res);
        expect(res.jsonBody.error.message).toMatch(/debe incluir/);
        expect(usuarioRepo.crearUsuarioProfesor).not.toHaveBeenCalled();
    });

    test("rechaza nombre demasiado corto", async () => {
        const req = mockRequest({ token: "tok", nombre: "A", password: "Abcdef1!gh" });
        const res = mockResponse();
        await invService.completar(req, res);
        expect(res.jsonBody.error.message).toMatch(/Nombre requerido/);
    });

    test("invitación no PENDIENTE → 'no disponible'", async () => {
        invRepo.buscarPorTokenHash.mockResolvedValue({
            invitacion_id: 1, estado: "COMPLETADA",
            expira_en: new Date(Date.now() + 3600000),
        });
        const req = mockRequest({ token: "tok", nombre: "Ana", password: "Abcdef1!gh" });
        const res = mockResponse();
        await invService.completar(req, res);
        expect(res.jsonBody.error.message).toMatch(/no disponible/);
    });

    test("crea profesor con un nombre con caracteres especiales sin romperse", async () => {
        invRepo.buscarPorTokenHash.mockResolvedValue({
            invitacion_id: 1, estado: "PENDIENTE",
            correo_destino: "nuevo@uv.cl",
            expira_en: new Date(Date.now() + 3600000),
        });
        usuarioRepo.correoYaRegistrado.mockResolvedValue(false);
        usuarioRepo.crearUsuarioProfesor.mockResolvedValue(77);
        invRepo.marcarCompletada.mockResolvedValue(undefined);

        const nombre = '<b>O\'Brien & "Co"</b>';
        const req = mockRequest({ token: "tok", nombre, password: "Abcdef1!gh" });
        const res = mockResponse();
        await invService.completar(req, res);

        expect(res.jsonBody.error).toBeUndefined();
        expect(res.jsonBody.data.usuario_id).toBe(77);
        // El nombre se persiste tal cual (escapado al renderizar, no aquí).
        expect(usuarioRepo.crearUsuarioProfesor).toHaveBeenCalledWith(
            nombre, "nuevo@uv.cl", expect.any(String)
        );
    });
});
