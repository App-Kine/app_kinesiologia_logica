"use strict";

/**
 * Tests del servicio analitica (RF-94..RF-104).
 *
 * Foco de seguridad (RNF-19 / anti-IDOR): el chequeo de propiedad es
 * OBLIGATORIO. Si falta profesorId responde "No autorizado" SIN tocar la BD;
 * si el profesorId no es dueño de la aplicación, NO devuelve datos.
 *
 * Repositorio mockeado: sin BD real.
 */

jest.mock("../../proyecto/repositories/analitica.repository", () => ({
    resumenPorProfesor: jest.fn(),
    resumenAplicacion: jest.fn(),
    preguntasPorAplicacion: jest.fn(),
    evaluacionesPorAplicacion: jest.fn(),
    tiemposPorEvaluacionPregunta: jest.fn(),
}));

const analiticaRepo = require("../../proyecto/repositories/analitica.repository");
const analiticaService = require("../../proyecto/services/analitica.service");
const { mockRequest, mockResponse } = require("../helpers/mockResponse");

describe("analitica.service.detalleAplicacion — autorización (anti-IDOR)", () => {
    beforeEach(() => jest.clearAllMocks());

    test("falta profesorId → 'No autorizado' SIN tocar la BD", async () => {
        const req = mockRequest({ aplicacionId: 5 }); // sin profesorId
        const res = mockResponse();
        await analiticaService.detalleAplicacion(req, res);

        expect(res.jsonBody.error.message).toMatch(/No autorizado/);
        // Crítico: ningún método del repo se invocó.
        expect(analiticaRepo.resumenAplicacion).not.toHaveBeenCalled();
        expect(analiticaRepo.preguntasPorAplicacion).not.toHaveBeenCalled();
    });

    test("profesorId no entero (0) → 'No autorizado' sin tocar BD", async () => {
        const req = mockRequest({ aplicacionId: 5, profesorId: 0 });
        const res = mockResponse();
        await analiticaService.detalleAplicacion(req, res);
        expect(res.jsonBody.error.message).toMatch(/No autorizado/);
        expect(analiticaRepo.resumenAplicacion).not.toHaveBeenCalled();
    });

    test("aplicacionId inválido → error antes del chequeo de propiedad", async () => {
        const req = mockRequest({ aplicacionId: 0, profesorId: 1 });
        const res = mockResponse();
        await analiticaService.detalleAplicacion(req, res);
        expect(res.jsonBody.error.message).toMatch(/aplicacionId/);
        expect(analiticaRepo.resumenAplicacion).not.toHaveBeenCalled();
    });

    test("profesor NO dueño → NO devuelve datos (mensaje neutro 'no encontrada')", async () => {
        analiticaRepo.resumenAplicacion.mockResolvedValue({
            aplicacion_id: 5,
            profesor_id: 99, // dueño real
        });
        const req = mockRequest({ aplicacionId: 5, profesorId: 1 }); // intruso
        const res = mockResponse();
        await analiticaService.detalleAplicacion(req, res);

        expect(res.jsonBody.data).toBeUndefined();
        expect(res.jsonBody.error.message).toMatch(/no encontrada/i);
        // No se cargaron los datos sensibles de la aplicación ajena.
        expect(analiticaRepo.preguntasPorAplicacion).not.toHaveBeenCalled();
        expect(analiticaRepo.evaluacionesPorAplicacion).not.toHaveBeenCalled();
    });

    test("aplicación inexistente → 'no encontrada'", async () => {
        analiticaRepo.resumenAplicacion.mockResolvedValue(null);
        const req = mockRequest({ aplicacionId: 5, profesorId: 1 });
        const res = mockResponse();
        await analiticaService.detalleAplicacion(req, res);
        expect(res.jsonBody.error.message).toMatch(/no encontrada/i);
        expect(analiticaRepo.preguntasPorAplicacion).not.toHaveBeenCalled();
    });

    test("profesor dueño → devuelve la analítica completa", async () => {
        analiticaRepo.resumenAplicacion.mockResolvedValue({
            aplicacion_id: 5,
            profesor_id: 1,
        });
        analiticaRepo.preguntasPorAplicacion.mockResolvedValue([{ pregunta_id: 1 }]);
        analiticaRepo.evaluacionesPorAplicacion.mockResolvedValue([{ evaluacion_id: 7 }]);
        analiticaRepo.tiemposPorEvaluacionPregunta.mockResolvedValue([]);

        const req = mockRequest({ aplicacionId: 5, profesorId: 1 });
        const res = mockResponse();
        await analiticaService.detalleAplicacion(req, res);

        expect(res.jsonBody.error).toBeUndefined();
        expect(res.jsonBody.data.resumen.aplicacion_id).toBe(5);
        expect(res.jsonBody.data.preguntas).toHaveLength(1);
        expect(res.jsonBody.data.evaluaciones).toHaveLength(1);
    });

    test("compara propiedad por valor numérico (profesor_id string vs profesorId number)", async () => {
        analiticaRepo.resumenAplicacion.mockResolvedValue({
            aplicacion_id: 5,
            profesor_id: "1", // viene como string desde BD
        });
        analiticaRepo.preguntasPorAplicacion.mockResolvedValue([]);
        analiticaRepo.evaluacionesPorAplicacion.mockResolvedValue([]);
        analiticaRepo.tiemposPorEvaluacionPregunta.mockResolvedValue([]);

        const req = mockRequest({ aplicacionId: 5, profesorId: 1 });
        const res = mockResponse();
        await analiticaService.detalleAplicacion(req, res);
        // "1" === 1 tras Number() → dueño, devuelve datos.
        expect(res.jsonBody.error).toBeUndefined();
        expect(res.jsonBody.data.resumen.aplicacion_id).toBe(5);
    });
});

describe("analitica.service.resumen", () => {
    beforeEach(() => jest.clearAllMocks());

    test("rechaza profesorId faltante", async () => {
        const req = mockRequest({});
        const res = mockResponse();
        await analiticaService.resumen(req, res);
        expect(res.jsonBody.error.message).toMatch(/profesorId/);
        expect(analiticaRepo.resumenPorProfesor).not.toHaveBeenCalled();
    });

    test("devuelve el resumen del profesor", async () => {
        analiticaRepo.resumenPorProfesor.mockResolvedValue([{ aplicacion_id: 1 }]);
        const req = mockRequest({ profesorId: 3 });
        const res = mockResponse();
        await analiticaService.resumen(req, res);
        expect(res.jsonBody.error).toBeUndefined();
        expect(res.jsonBody.data).toHaveLength(1);
        expect(analiticaRepo.resumenPorProfesor).toHaveBeenCalledWith(3);
    });
});
