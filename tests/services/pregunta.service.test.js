"use strict";

/**
 * Tests unitarios del servicio pregunta.
 * Cubre la validación de longitud (auditoría Día 3.2) y la validación de
 * alternativas (RF-65/66).
 *
 * Usa mock del repositorio para no requerir BD.
 */

jest.mock("../../proyecto/repositories/pregunta.repository", () => ({
    crearPreguntaConAlternativas: jest.fn(),
    listarPorProfesor: jest.fn(),
    obtenerConAlternativas: jest.fn(),
    editarPreguntaConAlternativas: jest.fn(),
    eliminarPregunta: jest.fn(),
    vincularATest: jest.fn(),
    desvincularDeTest: jest.fn(),
}));

const preguntaRepo = require("../../proyecto/repositories/pregunta.repository");
const preguntaService = require("../../proyecto/services/pregunta.service");
const { mockRequest, mockResponse } = require("../helpers/mockResponse");

describe("pregunta.service", () => {
    beforeEach(() => jest.clearAllMocks());

    describe("crear — validación de longitud", () => {
        test("rechaza enunciado > 10000 caracteres", async () => {
            const req = mockRequest({
                enunciado: "x".repeat(10001),
                explicacionClinica: "explicación válida",
                creadoPor: 1,
                alternativas: [
                    { texto: "a", esCorrecta: true, orden: 1 },
                    { texto: "b", esCorrecta: false, orden: 2 },
                ],
            });
            const res = mockResponse();
            await preguntaService.crear(req, res);
            expect(res.jsonBody.error).toBeDefined();
            expect(res.jsonBody.error.message).toMatch(/enunciado.*10000/);
            expect(preguntaRepo.crearPreguntaConAlternativas).not.toHaveBeenCalled();
        });

        test("acepta enunciado de más de 2000 caracteres (NVARCHAR MAX, pedido cliente)", async () => {
            preguntaRepo.crearPreguntaConAlternativas.mockResolvedValue(7);
            const req = mockRequest({
                enunciado: "x".repeat(5000),
                explicacionClinica: "explicación válida",
                creadoPor: 1,
                alternativas: [
                    { texto: "a", esCorrecta: true, orden: 1 },
                    { texto: "b", esCorrecta: false, orden: 2 },
                ],
            });
            const res = mockResponse();
            await preguntaService.crear(req, res);
            expect(res.jsonBody.error).toBeUndefined();
            expect(preguntaRepo.crearPreguntaConAlternativas).toHaveBeenCalled();
        });

        test("rechaza explicación > 4000 caracteres", async () => {
            const req = mockRequest({
                enunciado: "válido",
                explicacionClinica: "y".repeat(4001),
                creadoPor: 1,
                alternativas: [
                    { texto: "a", esCorrecta: true, orden: 1 },
                    { texto: "b", esCorrecta: false, orden: 2 },
                ],
            });
            const res = mockResponse();
            await preguntaService.crear(req, res);
            expect(res.jsonBody.error.message).toMatch(/explicación.*4000/);
        });

        test("rechaza alternativa con texto > 1000 caracteres", async () => {
            const req = mockRequest({
                enunciado: "válido",
                explicacionClinica: "explicación válida",
                creadoPor: 1,
                alternativas: [
                    { texto: "a".repeat(1001), esCorrecta: true, orden: 1 },
                    { texto: "b", esCorrecta: false, orden: 2 },
                ],
            });
            const res = mockResponse();
            await preguntaService.crear(req, res);
            expect(res.jsonBody.error.message).toMatch(/Alternativa.*1000/);
        });
    });

    describe("crear — validación de alternativas (RF-65/66)", () => {
        test("rechaza menos de 2 alternativas", async () => {
            const req = mockRequest({
                enunciado: "válido",
                explicacionClinica: "explicación",
                creadoPor: 1,
                alternativas: [{ texto: "única", esCorrecta: true, orden: 1 }],
            });
            const res = mockResponse();
            await preguntaService.crear(req, res);
            expect(res.jsonBody.error.message).toMatch(/2 y 5 alternativas/);
        });

        test("rechaza más de 5 alternativas", async () => {
            const req = mockRequest({
                enunciado: "válido",
                explicacionClinica: "explicación",
                creadoPor: 1,
                alternativas: Array.from({ length: 6 }, (_, i) => ({
                    texto: `alt ${i}`,
                    esCorrecta: i === 0,
                    orden: i + 1,
                })),
            });
            const res = mockResponse();
            await preguntaService.crear(req, res);
            expect(res.jsonBody.error.message).toMatch(/2 y 5 alternativas/);
        });

        test("rechaza si no hay exactamente 1 alternativa correcta", async () => {
            const req = mockRequest({
                enunciado: "válido",
                explicacionClinica: "explicación",
                creadoPor: 1,
                alternativas: [
                    { texto: "a", esCorrecta: true, orden: 1 },
                    { texto: "b", esCorrecta: true, orden: 2 },
                ],
            });
            const res = mockResponse();
            await preguntaService.crear(req, res);
            expect(res.jsonBody.error.message).toMatch(/1 alternativa correcta/);
        });

        test("rechaza órdenes duplicados", async () => {
            const req = mockRequest({
                enunciado: "válido",
                explicacionClinica: "explicación",
                creadoPor: 1,
                alternativas: [
                    { texto: "a", esCorrecta: true, orden: 1 },
                    { texto: "b", esCorrecta: false, orden: 1 },
                ],
            });
            const res = mockResponse();
            await preguntaService.crear(req, res);
            expect(res.jsonBody.error.message).toMatch(/duplicado/);
        });

        test("acepta una pregunta bien formada", async () => {
            preguntaRepo.crearPreguntaConAlternativas.mockResolvedValue(42);
            const req = mockRequest({
                enunciado: "¿Cuál es el ruido normal de auscultación?",
                explicacionClinica: "El murmullo vesicular.",
                creadoPor: 1,
                alternativas: [
                    { texto: "Murmullo vesicular", esCorrecta: true, orden: 1 },
                    { texto: "Soplo tubárico", esCorrecta: false, orden: 2 },
                ],
            });
            const res = mockResponse();
            await preguntaService.crear(req, res);
            expect(res.jsonBody.error).toBeUndefined();
            expect(res.jsonBody.data.pregunta_id).toBe(42);
            expect(preguntaRepo.crearPreguntaConAlternativas).toHaveBeenCalledTimes(1);
        });
    });

    describe("eliminar — propaga tests_desvinculados", () => {
        test("retorna cuántos tests quedaron desvinculados (cascade Día 3.1)", async () => {
            preguntaRepo.eliminarPregunta.mockResolvedValue({
                ok: true, tests_desvinculados: 3,
            });
            const req = mockRequest({ preguntaId: 10, creadoPor: 1 });
            const res = mockResponse();
            await preguntaService.eliminar(req, res);
            expect(res.jsonBody.data.tests_desvinculados).toBe(3);
        });

        test("propaga error si no es el creador", async () => {
            preguntaRepo.eliminarPregunta.mockResolvedValue({
                ok: false, reason: "FORBIDDEN",
            });
            const req = mockRequest({ preguntaId: 10, creadoPor: 99 });
            const res = mockResponse();
            await preguntaService.eliminar(req, res);
            expect(res.jsonBody.error.message).toMatch(/Solo el creador/);
        });
    });
});
