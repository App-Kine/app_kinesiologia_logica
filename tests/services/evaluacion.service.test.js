"use strict";

/**
 * Tests del flujo "no persistir incompletas" (Bloque P1.R3 modificado).
 *
 * Verifica que:
 *  - `corregir` NO crea evaluación.
 *  - `responder` y `finalizar` están deprecados.
 *  - `enviar` valida payload y solo persiste cuando llega bien.
 *  - El payload de `enviar` se rechaza si falta correo en IDENTIFICADA.
 */

jest.mock("../../proyecto/repositories/evaluacion.repository", () => ({
    aplicacionesActivas: jest.fn(),
    listarAplicacionesActivasPorCurso: jest.fn(),
    obtenerAplicacionActiva: jest.fn(),
    cargarPreguntas: jest.fn(),
    corregirIntento: jest.fn(),
    enviarEvaluacionCompleta: jest.fn(),
    obtenerEvaluacion: jest.fn(),
    registrarRespuesta: jest.fn(),
    finalizarEvaluacion: jest.fn(),
    obtenerInforme: jest.fn(),
    obtenerDetallePorPregunta: jest.fn(),
    obtenerInformeCompletoPorPregunta: jest.fn(),
    marcarInformeEnviado: jest.fn(),
}));
jest.mock("../../base/utils/mailer", () => ({ send: jest.fn() }));

const evalRepo = require("../../proyecto/repositories/evaluacion.repository");
const evalService = require("../../proyecto/services/evaluacion.service");
const { mockRequest, mockResponse } = require("../helpers/mockResponse");

describe("evaluacion.service — flujo 'no persistir incompletas'", () => {
    beforeEach(() => jest.clearAllMocks());

    describe("iniciar — NO debe persistir evaluación", () => {
        test("solo carga preguntas, nunca llama a iniciarEvaluacion", async () => {
            evalRepo.obtenerAplicacionActiva.mockResolvedValue({
                aplicacion_id: 1, test_id: 10, test_nombre: "Test A",
                orden_aleatorio: false,
            });
            evalRepo.cargarPreguntas.mockResolvedValue([
                { pregunta_id: 1, orden_presentacion: 1, enunciado: "?", alternativas: [] },
            ]);

            const req = mockRequest({ aplicacionId: 1, modalidad: "ANONIMA" });
            const res = mockResponse();
            await evalService.iniciar(req, res);

            // Respuesta correcta
            expect(res.jsonBody.error).toBeUndefined();
            expect(res.jsonBody.data.aplicacion_id).toBe(1);
            // No debe devolver evaluacion_id (NO se creó)
            expect(res.jsonBody.data.evaluacion_id).toBeUndefined();
        });

        test("rechaza modalidad IDENTIFICADA sin correo", async () => {
            const req = mockRequest({ aplicacionId: 1, modalidad: "IDENTIFICADA" });
            const res = mockResponse();
            await evalService.iniciar(req, res);
            expect(res.jsonBody.error.message).toMatch(/correo requerido/);
        });

        test("rechaza correo con formato inválido", async () => {
            const req = mockRequest({
                aplicacionId: 1, modalidad: "IDENTIFICADA", correo: "no-es-correo",
            });
            const res = mockResponse();
            await evalService.iniciar(req, res);
            expect(res.jsonBody.error.message).toMatch(/Formato de correo/);
        });
    });

    describe("corregir — NO persiste nada", () => {
        test("devuelve corrección sin llamar a registrarRespuesta", async () => {
            evalRepo.obtenerAplicacionActiva.mockResolvedValue({ aplicacion_id: 1, test_id: 10 });
            evalRepo.corregirIntento.mockResolvedValue({
                correcta: true,
                intento: 1,
                finalizadaPregunta: true,
                puedeReintentar: false,
                correctaAlternativaId: 5,
                explicacion: "Es la correcta",
            });
            const req = mockRequest({
                aplicacionId: 1, preguntaId: 10, alternativaId: 5, intento: 1,
            });
            const res = mockResponse();
            await evalService.corregir(req, res);

            expect(res.jsonBody.data.correcta).toBe(true);
            expect(res.jsonBody.data.correctaAlternativaId).toBe(5);
            // Crítico: registrarRespuesta NO debe haber sido llamado
            expect(evalRepo.registrarRespuesta).not.toHaveBeenCalled();
        });

        test("rechaza si la aplicación no está activa", async () => {
            evalRepo.obtenerAplicacionActiva.mockResolvedValue(null);
            const req = mockRequest({
                aplicacionId: 1, preguntaId: 10, alternativaId: 5, intento: 1,
            });
            const res = mockResponse();
            await evalService.corregir(req, res);
            expect(res.jsonBody.error.message).toMatch(/no está disponible/);
        });
    });

    describe("enviar — única operación que persiste", () => {
        test("rechaza si el array de respuestas está vacío", async () => {
            const req = mockRequest({
                aplicacionId: 1, modalidad: "ANONIMA", respuestas: [],
            });
            const res = mockResponse();
            await evalService.enviar(req, res);
            expect(res.jsonBody.error.message).toMatch(/al menos una pregunta/);
            expect(evalRepo.enviarEvaluacionCompleta).not.toHaveBeenCalled();
        });

        test("rechaza modalidad IDENTIFICADA sin correo", async () => {
            const req = mockRequest({
                aplicacionId: 1,
                modalidad: "IDENTIFICADA",
                respuestas: [{ preguntaId: 1, alternativaIntento1Id: 1, ordenPresentacion: 1 }],
            });
            const res = mockResponse();
            await evalService.enviar(req, res);
            expect(res.jsonBody.error.message).toMatch(/correo requerido/);
        });

        test("valida cada respuesta del array", async () => {
            const req = mockRequest({
                aplicacionId: 1,
                modalidad: "ANONIMA",
                respuestas: [
                    { preguntaId: 0, alternativaIntento1Id: 1 }, // inválido
                ],
            });
            const res = mockResponse();
            await evalService.enviar(req, res);
            expect(res.jsonBody.error.message).toMatch(/preguntaId inválido/);
        });

        test("llama al repositorio con el payload normalizado", async () => {
            evalRepo.enviarEvaluacionCompleta.mockResolvedValue({
                evaluacion_id: 100,
                evaluacion_uuid: "uuid-100",
                total_preguntas: 1,
                aciertos_primer: 1,
                aciertos_segundo: 0,
                incorrectas: 0,
                porcentaje_global: 100,
            });
            const req = mockRequest({
                aplicacionId: 1,
                modalidad: "IDENTIFICADA",
                correo: "alumno@uv.cl",
                respuestas: [
                    {
                        preguntaId: 10,
                        ordenPresentacion: 1,
                        alternativaIntento1Id: 5,
                        tiempoSegundos: 12,
                    },
                ],
            });
            const res = mockResponse();
            await evalService.enviar(req, res);

            expect(res.jsonBody.error).toBeUndefined();
            expect(res.jsonBody.data.evaluacion_id).toBe(100);
            expect(res.jsonBody.data.porcentaje_global).toBe(100);

            expect(evalRepo.enviarEvaluacionCompleta).toHaveBeenCalledTimes(1);
            const arg = evalRepo.enviarEvaluacionCompleta.mock.calls[0][0];
            expect(arg.aplicacionId).toBe(1);
            expect(arg.modalidad).toBe("IDENTIFICADA");
            expect(arg.correo).toBe("alumno@uv.cl");
            expect(arg.respuestas).toHaveLength(1);
            expect(arg.respuestas[0].preguntaId).toBe(10);
        });
    });

    describe("endpoints deprecados", () => {
        test("responder devuelve error pidiendo migrar", async () => {
            const req = mockRequest({});
            const res = mockResponse();
            await evalService.responder(req, res);
            expect(res.jsonBody.error.message).toMatch(/Endpoint deprecado/);
        });

        test("finalizar devuelve error pidiendo migrar", async () => {
            const req = mockRequest({});
            const res = mockResponse();
            await evalService.finalizar(req, res);
            expect(res.jsonBody.error.message).toMatch(/Endpoint deprecado/);
        });
    });
});
