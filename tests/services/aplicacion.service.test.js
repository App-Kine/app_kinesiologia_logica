"use strict";

/**
 * Tests del servicio aplicacion — foco en `reordenar` (pedido cliente 2026-06:
 * orden de los tests por curso). Verifica validación de entrada y el control
 * anti-IDOR (RNF-19/RF-71): solo reordena si el profesor pertenece al curso.
 *
 * Repositorio mockeado (no requiere BD).
 */

jest.mock("../../proyecto/repositories/aplicacion.repository", () => ({
    profesorPerteneceACurso: jest.fn(),
    reordenar: jest.fn(),
}));

const repo = require("../../proyecto/repositories/aplicacion.repository");
const service = require("../../proyecto/services/aplicacion.service");
const { mockRequest, mockResponse } = require("../helpers/mockResponse");

describe("aplicacion.service.reordenar", () => {
    beforeEach(() => jest.clearAllMocks());

    test("rechaza sin cursoId", async () => {
        const res = mockResponse();
        await service.reordenar(mockRequest({ aplicacionIds: [1, 2], profesorId: 7 }), res);
        expect(res.jsonBody.error).toBeDefined();
        expect(repo.reordenar).not.toHaveBeenCalled();
    });

    test("rechaza con lista de aplicaciones vacía", async () => {
        const res = mockResponse();
        await service.reordenar(mockRequest({ cursoId: 3, aplicacionIds: [], profesorId: 7 }), res);
        expect(res.jsonBody.error).toBeDefined();
        expect(repo.reordenar).not.toHaveBeenCalled();
    });

    test("anti-IDOR: si el profesor no pertenece al curso, NO reordena", async () => {
        repo.profesorPerteneceACurso.mockResolvedValue(false);
        const res = mockResponse();
        await service.reordenar(mockRequest({ cursoId: 3, aplicacionIds: [10, 20], profesorId: 7 }), res);
        expect(res.jsonBody.error).toBeDefined();
        expect(repo.reordenar).not.toHaveBeenCalled();
    });

    test("reordena cuando el profesor pertenece al curso", async () => {
        repo.profesorPerteneceACurso.mockResolvedValue(true);
        repo.reordenar.mockResolvedValue(2);
        const res = mockResponse();
        await service.reordenar(mockRequest({ cursoId: 3, aplicacionIds: [10, 20], profesorId: 7 }), res);
        expect(res.jsonBody.error).toBeUndefined();
        expect(repo.reordenar).toHaveBeenCalledWith(3, [10, 20]);
    });

    test("ignora ids inválidos del body (coerción y filtro)", async () => {
        repo.profesorPerteneceACurso.mockResolvedValue(true);
        repo.reordenar.mockResolvedValue(2);
        const res = mockResponse();
        await service.reordenar(
            mockRequest({ cursoId: 3, aplicacionIds: [10, "x", -1, 20], profesorId: 7 }),
            res
        );
        expect(repo.reordenar).toHaveBeenCalledWith(3, [10, 20]);
    });
});
